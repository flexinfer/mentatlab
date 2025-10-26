#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "Deploying MentatLab to k3s..."

# Apply manifests in order
echo "--- Creating namespace ---"
kubectl apply -f namespace.yaml

echo "--- Deploying Redis ---"
kubectl apply -f redis.yaml

echo "--- Deploying Orchestrator ---"
kubectl apply -f orchestrator.yaml

echo "--- Deploying Gateway ---"
kubectl apply -f gateway.yaml

echo "--- Deploying Frontend ---"
kubectl apply -f frontend.yaml

echo "--- Deploying Echo Agent ---"
kubectl apply -f echoagent.yaml

echo ""
echo "Deployment complete!"
echo ""
echo "Checking deployment status..."
kubectl get pods -n mentatlab
echo ""
echo "Services:"
kubectl get services -n mentatlab
echo ""
echo "To watch pod status: kubectl get pods -n mentatlab -w"
echo "To get frontend URL: kubectl get service frontend -n mentatlab"
echo "To view logs: kubectl logs -f deployment/<service-name> -n mentatlab"
