export default {
  routes: [
    {
      method: 'POST',
      path: '/orders/webhook',
      handler: 'order.confirmPayment',
      config: {
        auth: false,
      },
    },
  ],
};
