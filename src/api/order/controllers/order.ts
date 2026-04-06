import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async confirmPayment(ctx) {
    ctx.send({ status: 'success' });
  }
}));
