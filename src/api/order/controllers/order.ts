import { factories } from '@strapi/strapi';
import Stripe from 'stripe';

const UNPARSED_BODY = Symbol.for('unparsedBody');

type StripeWebhookEvent = {
  type: string;
  data: { object: { id: string } & Record<string, unknown> };
};

function parseUnitPrice(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Precio de producto inválido en base de datos');
  }
  return n;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2026-03-25.dahlia',
});

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async createPaymentIntent(ctx) {
    console.log('--- NUEVA PETICIÓN DESDE VUE ---');
    console.log('Datos recibidos en el body:', JSON.stringify(ctx.request.body, null, 2));
    console.log('---------------------------------');
    const { items } = (ctx.request.body as { items?: unknown }) ?? {};

    if (!Array.isArray(items) || items.length === 0) {
      return ctx.badRequest('Se requiere un arreglo items no vacío');
    }

    for (const raw of items) {
      if (raw === null || typeof raw !== 'object') {
        return ctx.badRequest('Cada item debe ser un objeto con documentId y quantity');
      }
      const { documentId, quantity } = raw as { documentId?: unknown; quantity?: unknown };

      if (typeof documentId !== 'string' || documentId.trim() === '') {
        return ctx.badRequest('documentId inválido en uno o más items');
      }
      if (
        typeof quantity !== 'number' ||
        !Number.isInteger(quantity) ||
        quantity < 1
      ) {
        return ctx.badRequest('quantity debe ser un entero mayor o igual a 1');
      }
    }

    const documentIds = [...new Set(items.map((i) => (i as { documentId: string }).documentId))];

    try {
      const products = await strapi.documents('api::product.product').findMany({
        filters: {
          documentId: { $in: documentIds },
        },
        fields: ['documentId', 'price', 'discountedPrice'],
        status: 'published',
      });

      const priceByDocumentId = new Map<string, number>();
      for (const p of products) {
        let unit: number;
        if (p.discountedPrice != null) {
          const parsedDiscount = parseUnitPrice(p.discountedPrice);
          unit = parsedDiscount > 0 ? parsedDiscount : parseUnitPrice(p.price);
        } else {
          unit = parseUnitPrice(p.price);
        }
        priceByDocumentId.set(p.documentId, unit);
      }

      if (priceByDocumentId.size !== documentIds.length) {
        return ctx.badRequest(
          'Uno o más productos no existen o no están publicados'
        );
      }

      let subtotal = 0;
      for (const line of items as { documentId: string; quantity: number }[]) {
        const unit = priceByDocumentId.get(line.documentId);
        if (unit === undefined) {
          return ctx.badRequest('Producto no encontrado en la base de datos');
        }
        subtotal += unit * line.quantity;
      }

      const cartConfig = await strapi.documents('api::cart-config.cart-config').findFirst();
      const dynamicTaxRate = cartConfig?.taxAmount ? cartConfig.taxAmount / 100 : 0.12;

      const grandTotal = subtotal * (1 + dynamicTaxRate);
      const amountInCents = Math.round(grandTotal * 100);

      if (!Number.isFinite(amountInCents) || amountInCents < 1) {
        throw new Error('Monto calculado inválido');
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'mxn',
        automatic_payment_methods: {
          enabled: true,
        },
      });

      const snapshot = (items as { documentId: string; quantity: number }[]).map((line) => {
        return {
          documentId: line.documentId,
          quantity: line.quantity,
          priceAtPurchase: priceByDocumentId.get(line.documentId) || 0,
        };
      });

      const nuevaOrden = await strapi.documents('api::order.order').create({
        data: {
          orderId: `ORD-${Date.now()}`,
          totalAmount: grandTotal,
          paymentStatus: 'pending',
          paymentId: paymentIntent.id,
          productsSnapshot: snapshot,
        }
      });

      ctx.send({
        clientSecret: paymentIntent.client_secret,
        documentId: nuevaOrden.documentId
      });
    } catch (err) {
      strapi.log.error(err);
      ctx.response.status = 500;
      ctx.send({
        error: err instanceof Error ? err.message : 'Error desconocido',
      });
    }
  },

  async confirmPayment(ctx) {
    console.log('🔔 --- NUEVO EVENTO DE STRIPE WEBHOOK ---');
    try {
      const event = ctx.request.body as any;
      console.log(`1. Tipo de evento recibido: ${event?.type}`);

      if (event?.type === 'payment_intent.succeeded') {
        const paymentIntentId = event.data.object.id;
        console.log(`2. Buscando orden con el paymentId: ${paymentIntentId}`);

        const order = await strapi.documents('api::order.order').findFirst({
          filters: {
            paymentId: { $eq: paymentIntentId },
          },
          status: 'draft',
        });

        if (order) {
          console.log(`3. ¡Orden encontrada! (Document ID: ${order.documentId}). Actualizando a paid...`);
          
          await strapi.documents('api::order.order').update({
            documentId: order.documentId,
            data: {
              paymentStatus: 'paid',
            } as Record<string, unknown>,
            paymentStatus: 'draft', 
          });

          console.log('✅ 4. ¡Orden guardada exitosamente!');
        } else {
          console.log('❌ 3. ERROR: No se encontró la orden ni siquiera en los borradores.');
        }
      }

      ctx.status = 200;
      return ctx.send({ received: true });
    } catch (err) {
      console.error('❌ Error en webhook:', err);
      ctx.status = 400;
      return ctx.send({ error: 'Error en webhook' });
    }
  },

  async updateAddress(ctx) {
    const { documentId } = ctx.params;
    const shippingAddress = (ctx.request.body as { data?: { shippingAddress?: unknown } })?.data
      ?.shippingAddress;

    try {
      const order = await strapi.documents('api::order.order').update({
        documentId,
        data: {
          shippingAddress,
        } as Record<string, unknown>,
      });

      ctx.send(order);
    } catch (err) {
      strapi.log.error(err);
      return ctx.internalServerError('No se pudo actualizar la dirección de envío');
    }
  },
}));
