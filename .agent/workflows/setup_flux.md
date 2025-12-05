---
description: Setup Flux GitOps for MentatLab (GitLab)
---

This workflow guides you through setting up Flux to manage the MentatLab application from your **GitLab** GitOps repository (`gitops`).

## Prerequisites

- A Kubernetes cluster with Flux installed.
- Access to your `gitops` repository on GitLab.
- The `mentatlab` source code pushed to a git repository that Flux can access (e.g., `mentatlab` repo in GitLab).

## 1. Prepare the Manifests

The `k8s/` directory in the `mentatlab` repository contains the Kubernetes manifests.

**Important**: The `k8s/ingress.yaml` file contains a placeholder `__INGRESS_CLASS__`. You must replace this with your cluster's ingress class (e.g., `nginx`, `traefik`) before Flux can apply it successfully.

1.  Edit `k8s/ingress.yaml` in the `mentatlab` repo:
    ```yaml
    # ...
    annotations:
      kubernetes.io/ingress.class: nginx # Replace with your class
    spec:
      ingressClassName: nginx # Replace with your class
    # ...
    ```
2.  Commit and push this change to the `mentatlab` repository.

### Secrets

The `deploy.sh` script optionally creates a `cloudflare-access` secret. If you need this secret:

1.  Create it manually in the namespace: `kubectl create secret generic cloudflare-access ...`
2.  Or use a GitOps-friendly secret management solution like SealedSecrets or SOPS to commit an encrypted secret to `k8s/`.

## 2. Add Flux Manifests to `gitops` Repo

In your `gitops` repository, add the following file (e.g., `apps/mentatlab.yaml`) to tell Flux to sync the `mentatlab` application.

**Note**: Replace `https://gitlab.com/your-org/mentatlab.git` with the actual HTTP clone URL of your `mentatlab` repository.

```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: mentatlab
  namespace: flux-system
spec:
  interval: 1m
  url: https://gitlab.com/your-org/mentatlab.git # <--- UPDATE THIS URL
  ref:
    branch: main
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: mentatlab
  namespace: flux-system
spec:
  interval: 1m
  targetNamespace: mentatlab
  sourceRef:
    kind: GitRepository
    name: mentatlab
  path: "./k8s"
  prune: true
  wait: true
```

Commit and push this file to your `gitops` repository. Flux should pick it up and deploy MentatLab.

## 3. Handling Image Updates

Currently, the manifests use the `latest` tag (e.g., `registry.harbor.lan/library/mentatlab-orchestrator:latest`).

- **Development**: If you push new images to the `latest` tag, Kubernetes will only pull the new image if the pod is restarted (and `imagePullPolicy` is `Always`). Flux will **not** automatically restart pods because the manifest (the tag `latest`) hasn't changed.
- **Production**: It is recommended to use immutable tags (e.g., `v1.0.0`, `sha-xyz`).
  - Update `build-and-push.sh` or your CI pipeline to push versioned tags.
  - Update the manifests in `k8s/` with the new tags.
  - Flux will detect the change in git and update the cluster.

### Automated Updates with Flux

If you want Flux to automatically update the image tags in git:

1.  Set up `ImageRepository` resources for each image.
2.  Set up `ImagePolicy` resources to select the latest version (e.g., semver).
3.  Set up `ImageUpdateAutomation` to commit the new tag to the `mentatlab` repository.
4.  Add markers to your manifests, e.g., `image: registry.harbor.lan/...:latest # {"$imagepolicy": "flux-system:mentatlab-orchestrator"}`.
