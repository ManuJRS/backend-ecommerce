import { factories } from '@strapi/strapi';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2026-03-25.dahlia',
});

// Funciones auxiliares (Mantener fuera del export para limpieza)
function parseUnitPrice(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Precio inválido');
  return n;
}

function normalizeOrderSnapshotLines(snapshot: unknown): { documentId: string; quantity: number }[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.map(raw => ({
    documentId: String(raw.documentId),
    quantity: Number(raw.quantity)
  })).filter(line => line.documentId && line.quantity > 0);
}

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  
  // 1. Crear Intento de Pago
  async createPaymentIntent(ctx) {
    const { items, shippingAddress, contact } = ctx.request.body as any;

    try {
      let subtotal = 0;
      const priceByDocumentId = new Map<string, number>();
      const reservedQtyByDocumentId = new Map<string, number>();

      // 1. Procesar items y calcular subtotal
      for (const item of items as { documentId: string; quantity: number }[]) {
        const variant = await strapi.documents('api::product-variant.product-variant').findOne({
          documentId: item.documentId,
          status: 'published',
        });

        if (!variant) return ctx.badRequest(`La variante con ID ${item.documentId} no existe.`);

        // Lógica de precio
        const unit = Number(variant.variantPriceWithDiscount) > 0 
          ? parseUnitPrice(variant.variantPriceWithDiscount) 
          : parseUnitPrice(variant.price);
        
        priceByDocumentId.set(item.documentId, unit);
        subtotal += unit * item.quantity;
      }

      // 2. Obtener configuración del carrito (Impuestos y Envío)
      const cartConfig = (await strapi.documents('api::cart-config.cart-config').findFirst()) as any;
      
      // 🚀 DEFINICIÓN DE dynamicTaxRate
      const dynamicTaxRate = cartConfig?.taxAmount ? cartConfig.taxAmount / 100 : 0.16; // 16% IVA por defecto en MX

      // 🚀 DEFINICIÓN DE shippingMethodText y shippingCost
      let shippingCost = cartConfig?.baseShippingCost || 0;
      let shippingMethodText = 'Envío Estándar';

      // 3. Crear el Snapshot para la orden
      const variantIds = (items as { documentId: string }[]).map(item => item.documentId);
      const variantsFromDb = await strapi.documents('api::product-variant.product-variant').findMany({
        filters: { documentId: { $in: variantIds } },
        fields: ['variantName', 'documentId'],
      });

      // 🚀 DEFINICIÓN DE snapshot
      const snapshot = (items as { documentId: string; quantity: number }[]).map((line) => {
        const vMatch = variantsFromDb.find(v => v.documentId === line.documentId);
        return {
          documentId: line.documentId,
          quantity: line.quantity,
          priceAtPurchase: priceByDocumentId.get(line.documentId) || 0,
          name: vMatch?.variantName || 'Variante Desconocida',
        };
      });

      // 4. Totales finales
      const grandTotal = (subtotal + shippingCost) * (1 + dynamicTaxRate);
      const amountInCents = Math.round(grandTotal * 100);

      // 5. Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'mxn',
        automatic_payment_methods: { enabled: true },
      });

      // 6. Crear la Orden con todos los campos requeridos
      const addr = shippingAddress as Record<string, any>;
      const contactData = contact as Record<string, any>;

      const nuevaOrden = await strapi.documents('api::order.order').create({
        data: {
          orderId: `ORD-${Date.now()}`,
          totalAmount: grandTotal,
          shippingAmount: shippingCost,
          shippingMethod: shippingMethodText,
          paymentStatus: 'pending',
          paymentId: paymentIntent.id,
          productsSnapshot: snapshot,
          firstName: addr.firstName,
          lastName: addr.lastName,
          address: addr.address,
          country: addr.country,
          state: addr.state,
          phone: addr.phone,
          city: addr.city,
          zipCode: addr.zipCode,
          email: contactData.email,
        } as any,
      });

      ctx.send({
        clientSecret: paymentIntent.client_secret,
        documentId: nuevaOrden.documentId
      });

    } catch (err) {
      strapi.log.error(err);
      ctx.throw(500, err instanceof Error ? err.message : 'Error interno');
    }
  },

  // 2. Webhook de Stripe
  async confirmPayment(ctx) {
    const event = ctx.request.body as any;
    if (event.type === 'payment_intent.succeeded') {
      const paymentId = event.data.object.id;
      const order = await strapi.documents('api::order.order').findFirst({
        filters: { paymentId },
      });

      if (order && order.paymentStatus !== 'paid') {
        await strapi.documents('api::order.order').update({
          documentId: order.documentId,
          data: { paymentStatus: 'paid', status: 'paid' } as any,
        });

        // Descontar stock de variantes
        const items = normalizeOrderSnapshotLines(order.productsSnapshot);
        for (const item of items) {
          const v = await strapi.documents('api::product-variant.product-variant').findOne({ documentId: item.documentId });
          if (v) {
            await strapi.documents('api::product-variant.product-variant').update({
              documentId: item.documentId,
              data: { stock: Math.max(0, (v.stock || 0) - item.quantity) } as any,
              status: 'published',
            });
          }
        }
      }
    }
    return ctx.send({ received: true });
  },

  // 3. Actualizar Dirección (El que faltaba)
  async updateAddress(ctx) {
    const { documentId } = ctx.params;
    const { shippingAddress } = (ctx.request.body as any)?.data || ctx.request.body;

    try {
      const updatedOrder = await strapi.documents('api::order.order').update({
        documentId,
        data: {
          address: shippingAddress?.address,
          city: shippingAddress?.city,
          zipCode: shippingAddress?.zipCode,
          phone: shippingAddress?.phone,
          // Otros campos que necesites...
        } as any,
      });

      return ctx.send(updatedOrder);
    } catch (err) {
      strapi.log.error(err);
      return ctx.internalServerError('No se pudo actualizar la dirección');
    }
  },
}));