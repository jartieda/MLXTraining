variable "project_id" {
  description = "ID del proyecto de GCP."
  type        = string
  default     = "mlxtraining"
}

variable "region" {
  description = "Región de GCP para desplegar Cloud Run."
  type        = string
  default     = "europe-west1"
}

variable "service_name" {
  description = "Nombre del servicio de Cloud Run."
  type        = string
  default     = "mlxtraining"
}

variable "image" {
  description = "Imagen Docker para desplegar, por ejemplo gcr.io/PROJECT_ID/mlxtraining:latest."
  type        = string
}

variable "environment" {
  description = "Entorno para la app."
  type        = string
  default     = "production"
}

variable "max_instances" {
  description = "Máximo de instancias para Cloud Run."
  type        = number
  default     = 1
}

variable "cpu_limit" {
  description = "Límite de CPU por instancia."
  type        = string
  default     = "1000m"
}

variable "memory_limit" {
  description = "Límite de memoria por instancia."
  type        = string
  default     = "512Mi"
}

variable "container_concurrency" {
  description = "Número máximo de solicitudes concurrentes por instancia."
  type        = number
  default     = 80
}

variable "allow_unauthenticated" {
  description = "Permitir acceso anónimo a la app."
  type        = bool
  default     = true
}

variable "vpc_access" {
  description = "Si se desea activar VPC egress, se mantiene false para tier gratuito."
  type        = bool
  default     = false
}
