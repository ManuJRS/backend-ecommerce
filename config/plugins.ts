import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  upload: {
    config: {
      provider: 'cloudinary',
      providerOptions: {
        cloud_name: env('CLOUDINARY_NAME'),
        api_key: env('CLOUDINARY_KEY'),
        api_secret: env('CLOUDINARY_SECRET'),
      },
      actionOptions: {
        upload: {
          folder: 'ecommerce_strapi',
        },
        uploadStream: {
          folder: 'ecommerce_strapi',
        },
        delete: {},
      },
    },
  },
  // Plugin para el dashboard de la tienda
  'store-dashboard': {
    enabled: true,
    resolve: './src/plugins/store-dashboard'
  },
});

export default config;