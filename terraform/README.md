# Terraform para Cloud Run (GCP)

Este directorio despliega la app estática de MLXTraining en Cloud Run usando una imagen Docker.

## Requisitos

- Terraform >= 1.6
- gcloud instalado y autenticado
- Proyecto de GCP con facturación habilitada o con el plan gratuito que aplique a Cloud Run

## Variables

```bash
export TF_VAR_project_id="tu-proyecto"
export TF_VAR_region="us-central1"
export TF_VAR_service_name="mlxtraining"
export TF_VAR_image="gcr.io/tu-proyecto/mlxtraining:latest"
```

## Inicializar y desplegar

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

## Acceso

La URL se devolverá al final del apply.

## Nota sobre tier gratuito

Cloud Run gratuito en GCP tiene límites de uso; para mantenerte dentro del tier gratuito:

- usa una instancia con CPU 1 vCPU y memoria 512Mi
- deja `max_instance_count = 1`
- usa `min_instance_count = 0`
- evita llamadas a APIs que generen egress persistente
- no habilites VPC ni servicios premium

