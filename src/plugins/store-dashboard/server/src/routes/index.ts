export default [
  {
    method: 'GET',
    path: '/stats',
    handler: 'controller.index',
    config: {
      policies: [],
      auth: false,
    },
  },
];