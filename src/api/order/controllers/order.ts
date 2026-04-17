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

function normalizeOrderSnapshotLines(snapshot: unknown): { documentId: string; quantity: number }[] {
  if (!Array.isArray(snapshot)) {
    return [];
  }
  const lines: { documentId: string; quantity: number }[] = [];
  for (const raw of snapshot) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const { documentId, quantity } = raw as { documentId?: unknown; quantity?: unknown };
    if (typeof documentId !== 'string' || documentId.trim() === '') {
      continue;
    }
    const q =
      typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0
        ? quantity
        : typeof quantity === 'string'
          ? parseInt(quantity, 10)
          : NaN;
    if (!Number.isFinite(q) || q < 1) {
      continue;
    }
    lines.push({ documentId, quantity: q });
  }
  return lines;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2026-03-25.dahlia',
});

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async createPaymentIntent(ctx) {
    console.log('--- NUEVA PETICIÓN DESDE VUE ---');
    console.log('Datos recibidos en el body:', JSON.stringify(ctx.request.body, null, 2));
    console.log('---------------------------------');
    const { items, zipCode, shippingAddress, contact } = (ctx.request.body as {
      items?: unknown;
      zipCode?: unknown;
      shippingAddress?: unknown;
      contact?: unknown;
    }) ?? {};

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

    if (
      !shippingAddress ||
      typeof shippingAddress !== 'object' ||
      Array.isArray(shippingAddress)
    ) {
      return ctx.badRequest('Faltan los datos de envío (shippingAddress).');
    }

    const requiredFields = [
      'firstName',
      'lastName',
      'address',
      'country',
      'phone',
      'city',
      'zipCode',
    ] as const;
    for (const field of requiredFields) {
      const value = (shippingAddress as Record<string, unknown>)[field];
      if (value === null || value === undefined) {
        return ctx.badRequest(`El campo ${field} es obligatorio.`);
      }
      const str = typeof value === 'string' ? value : String(value);
      if (str.trim() === '') {
        return ctx.badRequest(`El campo ${field} es obligatorio.`);
      }
    }

    const contactPayload = contact as { email?: unknown } | null | undefined;
    if (
      !contactPayload ||
      contactPayload.email === undefined ||
      contactPayload.email === null ||
      String(contactPayload.email).trim() === ''
    ) {
      return ctx.badRequest('El correo electrónico es obligatorio.');
    }

    const shipZip = String((shippingAddress as Record<string, unknown>).zipCode).trim();

    try {
      const priceByDocumentId = new Map<string, number>();
      const reservedQtyByDocumentId = new Map<string, number>();

      let subtotal = 0;

      for (const item of items as { documentId: string; quantity: number }[]) {
        const product = await strapi.documents('api::product.product').findOne({
          documentId: item.documentId,
          status: 'published',
        });

        if (!product) {
          return ctx.badRequest(`El producto con ID ${item.documentId} no existe.`);
        }

        const stockNum =
          typeof product.stock === 'number' && Number.isFinite(product.stock) ? product.stock : 0;

        const prevQty = reservedQtyByDocumentId.get(item.documentId) ?? 0;
        const totalRequestedForProduct = prevQty + item.quantity;

        if (stockNum < totalRequestedForProduct) {
          const p = product as { name?: string; title?: string };
          return ctx.badRequest('Stock insuficiente', {
            code: 'INSUFFICIENT_STOCK',
            productName: p.name || p.title || 'Producto',
            requested: item.quantity,
            available: stockNum,
          });
        }
        reservedQtyByDocumentId.set(item.documentId, totalRequestedForProduct);

        let unit: number;
        if (product.discountedPrice != null) {
          const parsedDiscount = parseUnitPrice(product.discountedPrice);
          unit = parsedDiscount > 0 ? parsedDiscount : parseUnitPrice(product.price);
        } else {
          unit = parseUnitPrice(product.price);
        }
        priceByDocumentId.set(item.documentId, unit);

        subtotal += unit * item.quantity;
      }

      const cartConfig = (await strapi.documents('api::cart-config.cart-config').findFirst()) as any;
      const dynamicTaxRate = cartConfig?.taxAmount ? cartConfig.taxAmount / 100 : 0.12;

      const totalItemCount = (items as { quantity: number }[]).reduce(
        (acc, item) => acc + item.quantity,
        0
      );

      // 0. ESTADO POR DEFECTO (Fallback / A convenir)
      let shippingCost = 0;
      let shippingMethodText = cartConfig?.fallbackShippingText || 'Envío por calcular';

      // 3. PRIORIDAD BAJA: Envío Base
      if (cartConfig?.enableBaseShipping) {
        shippingCost = cartConfig?.baseShippingCost || 0;
        shippingMethodText = 'Envío Estándar';
      }

      // 2. PRIORIDAD MEDIA: Envío Local
      if (
        cartConfig?.enableLocalShipping &&
        shipZip !== '' &&
        cartConfig?.localZipCodes
      ) {
        const localZipPrefixes = Array.isArray(cartConfig.localZipCodes)
          ? cartConfig.localZipCodes.map((code: unknown) => String(code).trim()).filter(Boolean)
          : String(cartConfig.localZipCodes)
              .split(',')
              .map((code) => code.trim())
              .filter(Boolean);

        const isLocalZip = localZipPrefixes.some((prefix: string) => shipZip.startsWith(prefix));

        if (isLocalZip) {
          shippingCost = cartConfig?.localShippingCost || 0;
          shippingMethodText = 'Envío Local';
        }
      }

      // 1. PRIORIDAD ALTA: Envío Gratis
      if (cartConfig?.enableFreeShipping) {
        if (
          cartConfig?.discountMode === 'discountByQuantity' &&
          totalItemCount >= (cartConfig?.quantityDiscount || 0)
        ) {
          shippingCost = 0;
          shippingMethodText = 'Envío Gratis';
        }

        if (
          cartConfig?.discountMode === 'discountByAmount' &&
          subtotal >= (cartConfig?.amountDiscount || 0)
        ) {
          shippingCost = 0;
          shippingMethodText = 'Envío Gratis';
        }
      }

      console.log('📦 --- DETECTIVE DE ENVÍOS ---');
      console.log('1. Subtotal de productos:', subtotal);
      console.log('2. Cantidad de artículos (totalItemCount):', totalItemCount);
      console.log('3. Modo de descuento (discountMode):', cartConfig.discountMode);
      console.log('4. Meta para envío gratis (quantityDiscount):', cartConfig.quantityDiscount);
      console.log('5. Costo base en DB (baseShippingCost):', cartConfig.baseShippingCost);
      console.log('6. Costo de envío APLICADO:', shippingCost);
      console.log('-----------------------------');
      const grandTotal = (subtotal + shippingCost) * (1 + dynamicTaxRate);
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

      const addr = shippingAddress as Record<string, string>;
      const contactData = contactPayload as { email: string; marketingOptIn?: boolean };

      const nuevaOrden = await strapi.documents('api::order.order').create({
        data: {
          orderId: `ORD-${Date.now()}`,
          totalAmount: grandTotal,
          shippingAmount: shippingCost,
          shippingMethod: shippingMethodText,
          firstName: addr.firstName,
          lastName: addr.lastName,
          messageText: addr.deliveryInstructions,
          address: addr.address,
          country: addr.country,
          phone: addr.phone,
          city: addr.city,
          zipCode: addr.zipCode,
          email: contactData.email,
          marketingOptIn: contactData.marketingOptIn === true,
          paymentStatus: 'pending',
          paymentId: paymentIntent.id,
          productsSnapshot: snapshot,
        } as any,
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
        });

        if (order) {
          console.log(`3. ¡Orden encontrada! (Document ID: ${order.documentId}). Actualizando a paid...`);

          const alreadyPaid =
            order.paymentStatus === 'paid' || (order as { status?: string }).status === 'paid';

          if (!alreadyPaid) {
            await strapi.documents('api::order.order').update({
              documentId: order.documentId,
              data: {
                paymentStatus: 'paid',
                status: 'paid',
              } as Record<string, unknown>,
            });

            const items = normalizeOrderSnapshotLines(
              (order as { productsSnapshot?: unknown }).productsSnapshot
            );

            for (const item of items) {
              const product = await strapi.documents('api::product.product').findOne({
                documentId: item.documentId,
                status: 'published',
              });
              if (product && typeof product.stock === 'number') {
                await strapi.documents('api::product.product').update({
                  documentId: item.documentId,
                  data: {
                    stock: Math.max(0, product.stock - item.quantity),
                  } as Record<string, unknown>,
                  status: 'published',
                });
              }
            }
          }

          console.log('✅ 4. ¡Orden guardada exitosamente!');
        } else {
          console.log('❌ 3. ERROR: No se encontró la orden con ese paymentId.');
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
