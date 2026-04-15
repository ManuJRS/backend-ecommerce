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
    {
      method: 'POST',
      path: '/orders/payment-intent',
      handler: 'order.createPaymentIntent',
      config: {
        auth: false,
      },
    },
    {
      method: 'PUT',
      path: '/orders/:documentId/address',
      handler: 'order.updateAddress',
      config: {
        auth: false,
      },
    },
  ],
};