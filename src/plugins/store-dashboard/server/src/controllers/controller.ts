import type { Core } from '@strapi/strapi';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  async index(ctx) {
    try {
      // Llamamos a la lógica que acabamos de escribir en el service
      const stats = await strapi
        .plugin('store-dashboard')
        .service('service')
        .getStats();

      ctx.body = stats;
    } catch (err) {
      ctx.throw(500, err);
    }
  },
});

export default controller;