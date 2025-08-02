import logging
import os
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
from kubernetes import client, config
from kubernetes.client.rest import ApiException

from services.orchestrator.app.manifest_validator import validate_agent_manifest, ValidationMode
from services.orchestrator.app.data_flow import get_data_flow_service, DataFlowService
from services.orchestrator.app.storage import StorageReference

logger = logging.getLogger(__name__)

class SchedulingService:
    """Real Kubernetes scheduling service for MentatLab agents."""
    
    def __init__(self):
        """Initialize the Kubernetes client."""
        self.namespace = os.getenv("MENTATLAB_NAMESPACE", "default")
        self.k8s_client = None
        self.apps_v1_api = None
        self.batch_v1_api = None
        self.core_v1_api = None
        self.data_flow_service = get_data_flow_service()
        
        try:
            # Try to load in-cluster config first (for production)
            config.load_incluster_config()
            logger.info("Loaded in-cluster Kubernetes configuration")
        except config.ConfigException:
            try:
                # Fallback to local kubeconfig (for development)
                config.load_kube_config()
                logger.info("Loaded local Kubernetes configuration")
            except config.ConfigException as e:
                logger.error(f"Failed to load Kubernetes configuration: {e}")
                raise
        
        # Initialize API clients
        self.k8s_client = client.ApiClient()
        self.apps_v1_api = client.AppsV1Api()
        self.batch_v1_api = client.BatchV1Api()
        self.core_v1_api = client.CoreV1Api()
        
        logger.info(f"SchedulingService initialized for namespace: {self.namespace}")
    
    def scheduleWorkflow(self, workflow_id: str, cron_schedule: str) -> str:
        """
        Schedule a workflow (maintains backward compatibility).
        For now, this creates a simple Job. In the future, this could create CronJobs.
        """
        logger.info(f"Scheduling workflow {workflow_id} with cron schedule: {cron_schedule}")
        
        # For backward compatibility, create a simple job
        # In a real implementation, this would parse the workflow and create multiple resources
        job_id = f"workflow-{workflow_id}-{uuid.uuid4().hex[:8]}"
        
        try:
            # Create a simple job for the workflow
            job_spec = self._create_workflow_job_spec(workflow_id, job_id)
            self.batch_v1_api.create_namespaced_job(
                namespace=self.namespace,
                body=job_spec
            )
            logger.info(f"Created Kubernetes Job: {job_id}")
            return job_id
        except ApiException as e:
            logger.error(f"Failed to create workflow job: {e}")
            raise
    
    def scheduleAgent(self, agent_manifest: Dict[str, Any], inputs: Dict[str, Any], execution_id: Optional[str] = None, skip_validation: bool = False) -> str:
        """
        Schedule an individual agent based on its manifest.
        
        Args:
            agent_manifest: The agent's manifest containing configuration
            inputs: Input data for the agent
            execution_id: Optional execution ID for tracking
            skip_validation: Skip manifest validation (for internal use)
            
        Returns:
            Resource ID (job ID or deployment name)
            
        Raises:
            ValueError: If manifest validation fails in strict mode
            ApiException: If Kubernetes operations fail
        """
        agent_id = agent_manifest.get("id", "unknown-agent")
        
        # Validate agent manifest before scheduling (unless explicitly skipped)
        if not skip_validation:
            validation_result = validate_agent_manifest(agent_manifest)
            
            if not validation_result.is_valid:
                error_msg = f"Agent manifest validation failed for {agent_id}: {'; '.join(validation_result.errors)}"
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            if validation_result.warnings:
                logger.warning(f"Agent manifest validation warnings for {agent_id}: {'; '.join(validation_result.warnings)}")
        
        # Process multimodal inputs and create storage references
        processed_inputs, created_references = self.data_flow_service.process_agent_inputs(
            agent_manifest, inputs
        )
        
        is_long_running = agent_manifest.get("longRunning", False)
        
        if execution_id:
            resource_id = f"{agent_id}-{execution_id}"
        else:
            resource_id = f"{agent_id}-{uuid.uuid4().hex[:8]}"
        
        logger.info(f"Scheduling agent {agent_id} (longRunning={is_long_running}) as {resource_id}")
        
        try:
            if is_long_running:
                return self._create_deployment(agent_manifest, processed_inputs, resource_id, created_references)
            else:
                return self._create_job(agent_manifest, processed_inputs, resource_id, created_references)
        except ApiException as e:
            logger.error(f"Failed to schedule agent {agent_id}: {e}")
            # Clean up created references on failure
            if created_references:
                self.data_flow_service.cleanup_references(created_references)
            raise
    
    def getJobStatus(self, job_id: str) -> Dict[str, Any]:
        """Get the status of a scheduled job or deployment."""
        try:
            # Try to get as Job first
            try:
                job = self.batch_v1_api.read_namespaced_job(name=job_id, namespace=self.namespace)
                return self._parse_job_status(job)
            except ApiException as job_e:
                if job_e.status == 404:
                    # Try to get as Deployment
                    try:
                        deployment = self.apps_v1_api.read_namespaced_deployment(name=job_id, namespace=self.namespace)
                        return self._parse_deployment_status(deployment)
                    except ApiException as deploy_e:
                        if deploy_e.status == 404:
                            return {"status": "not_found", "message": f"Resource {job_id} not found"}
                        raise deploy_e
                raise job_e
        except ApiException as e:
            logger.error(f"Failed to get status for {job_id}: {e}")
            return {"status": "error", "message": str(e)}
    
    def cleanupJob(self, job_id: str) -> bool:
        """Clean up a completed or failed job."""
        try:
            # Try to delete as Job first
            try:
                self.batch_v1_api.delete_namespaced_job(
                    name=job_id, 
                    namespace=self.namespace,
                    propagation_policy="Background"
                )
                logger.info(f"Deleted Job: {job_id}")
                return True
            except ApiException as job_e:
                if job_e.status == 404:
                    # Try to delete as Deployment
                    try:
                        self.apps_v1_api.delete_namespaced_deployment(
                            name=job_id, 
                            namespace=self.namespace,
                            propagation_policy="Background"
                        )
                        logger.info(f"Deleted Deployment: {job_id}")
                        return True
                    except ApiException as deploy_e:
                        if deploy_e.status == 404:
                            logger.warning(f"Resource {job_id} not found for cleanup")
                            return False
                        raise deploy_e
                raise job_e
        except ApiException as e:
            logger.error(f"Failed to cleanup {job_id}: {e}")
            return False
    
    def _create_job(self, agent_manifest: Dict[str, Any], inputs: Dict[str, Any], job_id: str, references: Optional[List[StorageReference]] = None) -> str:
        """Create a Kubernetes Job for a short-lived agent."""
        agent_id = agent_manifest.get("id", "unknown-agent")
        image = agent_manifest.get("image", "alpine:latest")
        resources = agent_manifest.get("resources", {})
        env_vars = agent_manifest.get("env", [])
        
        # Parse resource requirements
        resource_requests = self._parse_resource_requirements(resources, agent_manifest)
        
        # Create environment variables
        env_list = self._create_env_vars(env_vars, inputs)
        
        # Create Job specification
        job_spec = client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=client.V1ObjectMeta(
                name=job_id,
                labels={
                    "app": "mentatlab-agent",
                    "agent-id": agent_id,
                    "execution-type": "job"
                },
                annotations={
                    "mentatlab.io/agent-id": agent_id,
                    "mentatlab.io/scheduled-at": datetime.now(timezone.utc).isoformat(),
                }
            ),
            spec=client.V1JobSpec(
                template=client.V1PodTemplateSpec(
                    metadata=client.V1ObjectMeta(
                        labels={
                            "app": "mentatlab-agent",
                            "agent-id": agent_id,
                            "job-name": job_id
                        }
                    ),
                    spec=client.V1PodSpec(
                        containers=[
                            client.V1Container(
                                name="agent",
                                image=image,
                                env=env_list,
                                resources=client.V1ResourceRequirements(
                                    requests=resource_requests.get("requests", {}),
                                    limits=resource_requests.get("limits", {})
                                )
                            )
                        ],
                        restart_policy="Never"
                    )
                ),
                backoff_limit=3
            )
        )
        
        # Create the Job
        self.batch_v1_api.create_namespaced_job(
            namespace=self.namespace,
            body=job_spec
        )
        
        logger.info(f"Created Kubernetes Job: {job_id} for agent {agent_id}")
        return job_id
    
    def _create_deployment(self, agent_manifest: Dict[str, Any], inputs: Dict[str, Any], deployment_name: str, references: Optional[List[StorageReference]] = None) -> str:
        """Create a Kubernetes Deployment for a long-running agent."""
        agent_id = agent_manifest.get("id", "unknown-agent")
        image = agent_manifest.get("image", "alpine:latest")
        resources = agent_manifest.get("resources", {})
        env_vars = agent_manifest.get("env", [])
        
        # Parse resource requirements
        resource_requests = self._parse_resource_requirements(resources, agent_manifest)
        
        # Create environment variables
        env_list = self._create_env_vars(env_vars, inputs)
        
        # Create Deployment specification
        deployment_spec = client.V1Deployment(
            api_version="apps/v1",
            kind="Deployment",
            metadata=client.V1ObjectMeta(
                name=deployment_name,
                labels={
                    "app": "mentatlab-agent",
                    "agent-id": agent_id,
                    "execution-type": "deployment"
                },
                annotations={
                    "mentatlab.io/agent-id": agent_id,
                    "mentatlab.io/scheduled-at": datetime.now(timezone.utc).isoformat(),
                }
            ),
            spec=client.V1DeploymentSpec(
                replicas=1,
                selector=client.V1LabelSelector(
                    match_labels={
                        "app": "mentatlab-agent",
                        "agent-id": agent_id,
                        "deployment-name": deployment_name
                    }
                ),
                template=client.V1PodTemplateSpec(
                    metadata=client.V1ObjectMeta(
                        labels={
                            "app": "mentatlab-agent",
                            "agent-id": agent_id,
                            "deployment-name": deployment_name
                        }
                    ),
                    spec=client.V1PodSpec(
                        containers=[
                            client.V1Container(
                                name="agent",
                                image=image,
                                env=env_list,
                                resources=client.V1ResourceRequirements(
                                    requests=resource_requests.get("requests", {}),
                                    limits=resource_requests.get("limits", {})
                                )
                            )
                        ]
                    )
                )
            )
        )
        
        # Create the Deployment
        self.apps_v1_api.create_namespaced_deployment(
            namespace=self.namespace,
            body=deployment_spec
        )
        
        logger.info(f"Created Kubernetes Deployment: {deployment_name} for agent {agent_id}")
        return deployment_name
    
    def _create_workflow_job_spec(self, workflow_id: str, job_id: str) -> client.V1Job:
        """Create a basic job spec for workflow scheduling (backward compatibility)."""
        return client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=client.V1ObjectMeta(
                name=job_id,
                labels={
                    "app": "mentatlab-workflow",
                    "workflow-id": workflow_id,
                    "execution-type": "workflow-job"
                },
                annotations={
                    "mentatlab.io/workflow-id": workflow_id,
                    "mentatlab.io/scheduled-at": datetime.now(timezone.utc).isoformat(),
                }
            ),
            spec=client.V1JobSpec(
                template=client.V1PodTemplateSpec(
                    metadata=client.V1ObjectMeta(
                        labels={
                            "app": "mentatlab-workflow",
                            "workflow-id": workflow_id,
                            "job-name": job_id
                        }
                    ),
                    spec=client.V1PodSpec(
                        containers=[
                            client.V1Container(
                                name="workflow-executor",
                                image="alpine:latest",
                                command=["sh", "-c", f"echo 'Executing workflow {workflow_id}'; sleep 10"]
                            )
                        ],
                        restart_policy="Never"
                    )
                ),
                backoff_limit=3
            )
        )
    
    def _parse_resource_requirements(self, resources: Dict[str, Any], agent_manifest: Dict[str, Any] = None) -> Dict[str, Dict[str, str]]:
        """Parse resource requirements from agent manifest, with multimodal considerations."""
        result = {"requests": {}, "limits": {}}
        
        # Check if agent uses multimodal types for enhanced resource allocation
        has_multimodal = False
        if agent_manifest:
            input_types = {pin.get("type", "string") for pin in agent_manifest.get("inputs", [])}
            output_types = {pin.get("type", "string") for pin in agent_manifest.get("outputs", [])}
            all_types = input_types | output_types
            has_multimodal = bool(all_types & {"audio", "image", "video", "stream"})
        
        # Handle GPU requirements
        if resources.get("gpu", False):
            result["requests"]["nvidia.com/gpu"] = "1"
            result["limits"]["nvidia.com/gpu"] = "1"
        
        # Handle CPU and memory (if specified in manifest)
        if "cpu" in resources:
            result["requests"]["cpu"] = str(resources["cpu"])
            result["limits"]["cpu"] = str(resources["cpu"])
        else:
            # Enhanced defaults for multimodal processing
            if has_multimodal:
                result["requests"]["cpu"] = "500m"
                result["limits"]["cpu"] = "2000m"  # 2 cores for multimodal
            else:
                result["requests"]["cpu"] = "100m"
                result["limits"]["cpu"] = "500m"
        
        if "memory" in resources:
            result["requests"]["memory"] = str(resources["memory"])
            result["limits"]["memory"] = str(resources["memory"])
        else:
            # Enhanced defaults for multimodal processing
            if has_multimodal:
                result["requests"]["memory"] = "512Mi"
                result["limits"]["memory"] = "2Gi"  # More memory for media processing
            else:
                result["requests"]["memory"] = "128Mi"
                result["limits"]["memory"] = "512Mi"
        
        return result
    
    def _create_env_vars(self, env_vars: List[str], inputs: Dict[str, Any]) -> List[client.V1EnvVar]:
        """Create environment variables for the container."""
        env_list = []
        
        # Add environment variables from manifest
        for env_var in env_vars:
            if "=" in env_var:
                key, value = env_var.split("=", 1)
                env_list.append(client.V1EnvVar(name=key, value=value))
        
        # Add inputs as environment variables
        for key, value in inputs.items():
            env_name = f"INPUT_{key.upper()}"
            env_list.append(client.V1EnvVar(name=env_name, value=str(value)))
        
        return env_list
    
    def _parse_job_status(self, job: client.V1Job) -> Dict[str, Any]:
        """Parse Kubernetes Job status into a standardized format."""
        status = job.status
        conditions = status.conditions or []
        
        if status.succeeded:
            return {
                "status": "succeeded",
                "active": status.active or 0,
                "succeeded": status.succeeded,
                "failed": status.failed or 0,
                "start_time": status.start_time.isoformat() if status.start_time else None,
                "completion_time": status.completion_time.isoformat() if status.completion_time else None
            }
        elif status.failed:
            return {
                "status": "failed",
                "active": status.active or 0,
                "succeeded": status.succeeded or 0,
                "failed": status.failed,
                "start_time": status.start_time.isoformat() if status.start_time else None,
                "conditions": [{"type": c.type, "reason": c.reason, "message": c.message} for c in conditions]
            }
        elif status.active:
            return {
                "status": "running",
                "active": status.active,
                "succeeded": status.succeeded or 0,
                "failed": status.failed or 0,
                "start_time": status.start_time.isoformat() if status.start_time else None
            }
        else:
            return {
                "status": "pending",
                "active": 0,
                "succeeded": 0,
                "failed": 0,
                "conditions": [{"type": c.type, "reason": c.reason, "message": c.message} for c in conditions]
            }
    
    def _parse_deployment_status(self, deployment: client.V1Deployment) -> Dict[str, Any]:
        """Parse Kubernetes Deployment status into a standardized format."""
        status = deployment.status
        
        return {
            "status": "running" if status.ready_replicas else "pending",
            "replicas": status.replicas or 0,
            "ready_replicas": status.ready_replicas or 0,
            "available_replicas": status.available_replicas or 0,
            "updated_replicas": status.updated_replicas or 0,
            "conditions": [
                {"type": c.type, "status": c.status, "reason": c.reason, "message": c.message} 
                for c in (status.conditions or [])
            ]
        }