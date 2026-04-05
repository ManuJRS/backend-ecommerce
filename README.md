# 🛒 Backend E-commerce MVP - Strapi 5 & Docker

Este repositorio contiene el código fuente del backend para un MVP de e-commerce, construido con **Strapi 5 (Headless CMS)**. La infraestructura está completamente dockerizada para garantizar la paridad entre el entorno de desarrollo local y la producción (preparado para despliegues en plataformas PaaS como DigitalOcean App Platform o VPS).

## 🚀 Tecnologías Utilizadas

* **Framework:** [Strapi v5](https://strapi.io/) (TypeScript)
* **Base de Datos:** PostgreSQL 15
* **Almacenamiento de Media:** Cloudinary (Integración nativa)
* **Infraestructura:** Docker & Docker Compose
* **Gestor de Paquetes:** npm

---

## ⚙️ Requisitos Previos

Para ejecutar este proyecto en local, solo necesitas tener instalado:
* **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (Asegúrate de tener asignados al menos 4GB de RAM en los recursos de Docker y la integración con WSL activada si usas Windows).

---

## 🛠️ Instalación y Configuración Local

### 1. Clonar el repositorio

```bash
git clone <url-de-tu-repo>
cd backend-ecommerce
```

### 2. Levantar la Infraestructura

El proyecto utiliza un Dockerfile optimizado para npm y un `docker-compose.yml` que levanta tanto la base de datos como la aplicación. Ejecuta:

```bash
docker compose up -d --build
```

---

## 🏗️ Arquitectura de Datos

Las colecciones fueron modeladas siguiendo estrictamente las convenciones de nombramiento de Strapi 5 (kebab-case para identificadores, Title Case para visualización).

* **Category (Categoría):** `name`, `slug`, `description`.
* **Product (Producto):** `name`, `slug`, `sku`, `price`, `stock`, `description` (Rich Text), `images` (Media vinculada a Cloudinary).
* **Relación:** Muchos a Muchos entre `Products` y `Categories`.

---

## ☁️ Integración con Cloudinary

Las imágenes no se guardan en el volumen local del contenedor. El proyecto está configurado para enviar toda la media a una carpeta específica en Cloudinary (`ecommerce_strapi`).

La configuración del proveedor se encuentra en `config/plugins.ts` y las políticas de seguridad (CSP) necesarias para previsualizar las imágenes en el panel de administración están configuradas en `config/middlewares.ts`.

---

## 🐛 Troubleshooting y Errores Comunes (Lecciones Aprendidas)

Durante el desarrollo de este entorno, resolvimos los siguientes obstáculos:

### Error `"/yarn.lock": not found` durante el build:
* **Causa:** Conflicto entre el gestor de paquetes por defecto de Strapi y el contenedor.
* **Solución Aplicada:** El proyecto fue migrado a npm. El `Dockerfile` y el `docker-compose.yml` (en la sección de volúmenes) ahora apuntan explícitamente a `package-lock.json` en lugar de `yarn.lock`.

### Error `Cannot find module 'cloudinary'` al arrancar Strapi:
* **Causa:** Al modificar el `.env` o agregar un nuevo plugin (`npm install @strapi/provider-upload-cloudinary` dentro del contenedor), Docker reinicia usando la imagen base sin las nuevas dependencias.
* **Solución:** Siempre que se instalen nuevos paquetes, es obligatorio reconstruir la imagen ejecutando `docker compose up -d --build` para que Docker lea el `package.json` actualizado.

### Advertencia `version is obsolete` en Docker Compose:
Las versiones recientes de Docker Compose ignoran la etiqueta `version: '3.8'`. Es una advertencia que no afecta el funcionamiento del contenedor.

### Error de conexión con el demonio de Docker (`var/run/docker.sock`):
Si la terminal arroja este error, verifica que Docker Desktop esté abierto y ejecutándose en segundo plano antes de lanzar cualquier comando `docker compose`.

---

## 📡 Consumo de la API

Para que tu aplicación Frontend (Vue, React, etc.) pueda consumir el catálogo:

1. Asegúrate de habilitar los permisos `find` y `findOne` en **Settings > Roles > Public** dentro del panel de Strapi.
2. Realiza peticiones `GET` incluyendo el parámetro `populate` para traer las relaciones (imágenes y categorías):

```http
GET http://localhost:1337/api/products?populate=*
```