import { factories } from '@strapi/strapi';
import Stripe from 'stripe';
import axios from 'axios';

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

async function calculateFinalShipping(strapi: any, items: any[], zipCode: string, config: any, subtotal: number): Promise<any[]> {
  let finalRates: any[] = [];
  const shipCfg = config?.shippingConfiguration ?? {};

  // 1. VALIDACIÓN DE ENVÍO GRATIS (reglas en componente shippingConfiguration)
  let isFreeShipping = false;
  const totalQuantity = items.reduce((acc: number, item: any) => acc + Math.max(0, Number(item.quantity) || 0), 0);

  if (shipCfg.discountMode === 'discountByQuantity') {
    if (totalQuantity >= (Number(shipCfg.quantityDiscount) || 0)) isFreeShipping = true;
  } else if (shipCfg.discountMode === 'discountByAmount') {
    if (Number(subtotal) >= (Number(shipCfg.amountDiscount) || 0)) isFreeShipping = true;
  }

  if (isFreeShipping) {
    return [{
      id: 'free-shipping',
      carrier: 'Promoción',
      service: shipCfg.shippingFreeText || 'Envío Gratis',
      price: 0,
      days: '3-7'
    }];
  }

  // 2. TARIFA LOCAL
  const isLocalEnabled = config.enableLocalShipping === true;
  const cleanZip = String(zipCode || '').trim();
  const allowedPrefixes = config.localZipCodes?.split(',').map((z: string) => z.trim()) || [];
  const isMatch = allowedPrefixes.some((prefix: string) => cleanZip.startsWith(prefix));

  if (isLocalEnabled && isMatch) {
    finalRates.push({
      id: 'local_delivery',
      carrier: 'Entrega Local',
      service: 'Reparto a domicilio (Mérida)',
      price: Number(config.localShippingCost || 0),
      days: '1-2'
    });
  }

  // 3. ENVIOCLICK API
  if (config.enableEnvioclick) {
    try {
      let totalWeight = 0, packageHeight = 0, maxWidth = 0, maxLength = 0;
        for (const item of items) {
          console.log(`[calculateFinalShipping] Buscando dimensiones para:`, item.documentId);
          
          let productData = await strapi.documents('api::product-variant.product-variant').findOne({
            documentId: item.documentId,
            status: 'published',
            locale: 'all',
            populate: { PhysicalData: true }
          }) as any;

          if (!productData) {
            productData = await strapi.documents('api::product.product').findOne({
              documentId: item.documentId,
              status: 'published',
              locale: 'all',
              populate: { PhysicalData: true }
            }) as any;
          }

          if (!productData) {
            throw new Error(`Producto no encontrado con ID: ${item.documentId}`);
          }

         const qty = Math.max(0, Number(item.quantity) || 1);
         const weight = Number(productData?.PhysicalData?.weight) || 1;
         const height = Number(productData?.PhysicalData?.height) || 10;
         const width = Number(productData?.PhysicalData?.width) || 10;
         const length = Number(productData?.PhysicalData?.length) || 10;

         totalWeight += weight * qty;
         packageHeight += height * qty;
         maxWidth = Math.max(maxWidth, width);
         maxLength = Math.max(maxLength, length);
      }

      const response = await axios.post('https://api.envioclickpro.com/api/v2/quotation', {
        origin_zip_code: "97000",
        destination_zip_code: String(cleanZip),
        origin_address: "Centro", origin_number: "1", origin_suburb: "Centro",
        destination_address: "Conocido", destination_number: "1", destination_suburb: "Centro",
        package: {
          description: "Pedido",
          contentValue: 1,
          weight: totalWeight || 1,
          length: maxLength || 10,
          height: packageHeight || 10,
          width: maxWidth || 10
        }
      }, {
        headers: { 'Authorization': process.env.ENVIOCLICK_API_KEY, 'Content-Type': 'application/json' }
      });

      if (response.data?.data?.rates) {
        const apiRates = response.data.data.rates.map((rate: any) => ({
          id: rate.idRate,
          carrier: rate.carrier,
          service: rate.product,
          price: Number(rate.total),
          days: rate.deliveryDays
        }));
        finalRates = [...finalRates, ...apiRates];
      }
    } catch (e) {
      console.error('Error en API, continuando con tarifas manuales');
    }
  }

  // 4. TARIFA NACIONAL FIJA
  if (finalRates.length === 0 && config.enableBaseShipping) {
    finalRates.push({
      id: 'standard_shipping',
      carrier: 'Envío Estándar',
      service: 'Tarifa nacional fija',
      price: Number(config.baseShippingCost || 0),
      days: '3-5'
    });
  }

  return finalRates;
}

async function updateHibridStock(strapi, items) {
  for (const item of items) {
    console.log(`[Stock] Procesando ID: ${item.documentId}`);
    try {
      // 1. Intentar como Variante
      const variant = await strapi.documents('api::product-variant.product-variant').findOne({
        documentId: item.documentId, status: 'published', fields: ['stock']
      });
      if (variant) {
        await strapi.documents('api::product-variant.product-variant').update({
          documentId: item.documentId,
          data: { stock: Math.max(0, (variant.stock || 0) - item.quantity) } as any,
          status: 'published',
        });
        continue;
      }
    } catch (e) { /* Fallback a producto simple */ }

    try {
      // 2. Intentar como Producto Simple
      const product = await strapi.documents('api::product.product').findOne({
        documentId: item.documentId, status: 'published', fields: ['stock']
      });
      if (product) {
        await strapi.documents('api::product.product').update({
          documentId: item.documentId,
          data: { stock: Math.max(0, (product.stock || 0) - item.quantity) } as any,
          status: 'published',
        });
      }
    } catch (e) {
      console.error(`❌ No se pudo actualizar stock para ${item.documentId}`);
    }
  }
}

export default factories.createCoreController('api::order.order', ({ strapi }) => ({

  async estimateShipping(ctx) {
    const { items, zipCode, subtotal } = ctx.request.body; 
  
    try {
      const config = await strapi.documents('api::cart-config.cart-config').findFirst({
        populate: ['shippingConfiguration'] // 👈 Agregamos el populate para las reglas
      }) as any;
  
      const finalRates = await calculateFinalShipping(strapi, items, zipCode, config, subtotal);
      
      return ctx.send(finalRates);
    } catch (error) {
      ctx.throw(500, 'Error al calcular envío');
    }
  },
  
  // 1. Crear Intento de Pago
  async createPaymentIntent(ctx) {
    const { paymentMethod, items, shippingAddress, contact, shippingRateId } = ctx.request.body as any;
    const uids = Object.keys(strapi.contentTypes);
    console.log('📋 UIDs disponibles en Strapi:', uids.filter(u => u.includes('product')));

    try {
      // Intento de búsqueda genérica
      const allVariants = await strapi.documents('api::product-variant.product-variant').findMany({
        limit: 1
      });
      console.log('📊 ¿Hay alguna variante en la DB?:', allVariants.length > 0 ? 'SÍ' : 'NO, LA TABLA ESTÁ VACÍA');
    } catch (e) {
      console.error('❌ Error crítico al intentar leer la tabla:', e.message);
    }

    try {
      if (!Array.isArray(items) || items.length === 0) {
        return ctx.badRequest('Faltan productos en el pedido.');
      }

      const subtotal = (items as { price: unknown; quantity: unknown }[]).reduce(
        (acc, item) => acc + Number(item.price) * Number(item.quantity),
        0
      );

      if (!Number.isFinite(subtotal) || subtotal < 0) {
        return ctx.badRequest('Subtotal inválido: verifica price y quantity en cada ítem.');
      }

      // 2. Configuración del carrito (envío: shippingConfiguration)
      const cartConfig = (await strapi.documents('api::cart-config.cart-config').findFirst({
        populate: ['shippingConfiguration', 'SummaryResume'],
      })) as any;

      const shipCfg = cartConfig?.shippingConfiguration ?? {};

      if (paymentMethod === 'transfer' && !cartConfig?.allowBankTransfer) {
        return ctx.badRequest('Las transferencias bancarias no están disponibles en este momento.');
      }

      if (shippingRateId === 'free-shipping' || shippingRateId === 'free_shipping') {
        if (shipCfg.discountMode === 'N/A' || !shipCfg.discountMode) {
          return ctx.badRequest('Envío gratis no está activo en la configuración actual.');
        }
        if (shipCfg.discountMode === 'discountByAmount') {
          const threshold = Number(shipCfg.amountDiscount) || 0;
          if (subtotal < threshold) {
            return ctx.badRequest('El subtotal no alcanza el monto configurado para envío gratis.');
          }
        } else if (shipCfg.discountMode === 'discountByQuantity') {
          const qty = (items as { quantity: unknown }[]).reduce(
            (a, it) => a + Math.max(0, Number(it.quantity) || 0),
            0
          );
          const threshold = Number(shipCfg.quantityDiscount) || 0;
          if (qty < threshold) {
            return ctx.badRequest('La cantidad de artículos no alcanza el mínimo para envío gratis.');
          }
        }
      }

      if (shippingRateId === 'base-shipping') {
        if (!cartConfig?.enableBaseShipping) {
          return ctx.badRequest('La tarifa base no está habilitada en la configuración.');
        }
        // Validamos que el costo sea un número válido
        if (typeof cartConfig.baseShippingCost !== 'number') {
          return ctx.badRequest('El costo de envío base no está configurado correctamente.');
        }
      }

      const nameByDocumentId = new Map<string, string>();

      for (const item of items as { documentId: string; quantity: number }[]) {
        console.log(`[createPaymentIntent] Buscando DocumentID: ${item.documentId}`);

        let productData = await (strapi.documents('api::product-variant.product-variant' as any)).findOne({
          documentId: item.documentId,
          status: 'published',
          locale: 'all',
          fields: ['variantName'] as any,
          populate: { PhysicalData: true } as any,
        }) as any;

        if (!productData) {
          productData = await (strapi.documents('api::product.product' as any)).findOne({
            documentId: item.documentId,
            status: 'published',
            locale: 'all',
            fields: ['name'] as any,
            populate: { PhysicalData: true } as any,
          }) as any;
        }

        if (!productData) {
          console.error(`❌ ERROR: El documento ${item.documentId} no existe en product-variant ni en product.`);
          throw new Error(`Producto no encontrado con ID: ${item.documentId}`);
        }

        nameByDocumentId.set(item.documentId, productData.variantName || productData.name || 'Desconocido');
      }

      const dynamicTaxRate = cartConfig?.taxAmount ? cartConfig.taxAmount / 100 : 0.16;

      const zipCode = shippingAddress?.zipCode || '';
      const finalRates = await calculateFinalShipping(strapi, items, zipCode, cartConfig, subtotal);
      
      const selectedRate = finalRates.find(
        (r) =>
          r.id === shippingRateId ||
          (r.id === 'free-shipping' && shippingRateId === 'free_shipping')
      );
      
      
let shippingCost = 0;
      let shippingData = {
        rateId: String(shippingRateId),
        carrier: 'Envío Estándar',
        serviceName: 'Tarifa Fija',
        days: '3-5',
        price: 0
      };

      if (selectedRate) {
        shippingCost = Number(selectedRate.price);
        shippingData = {
          rateId: String(selectedRate.id),
          carrier: selectedRate.carrier,
          serviceName: selectedRate.service,
          days: String(selectedRate.days || '3-5'),
          price: shippingCost
        };
      } else if (shippingRateId === 'base-shipping') {
        // Asignamos los valores directamente desde cart-config
        shippingCost = Number(cartConfig.baseShippingCost);
        shippingData.price = shippingCost;
        shippingData.carrier = 'Envío Nacional';
        shippingData.serviceName = 'Tarifa Base';
      } else if (finalRates.length > 0) {
        return ctx.badRequest('Tarifa de envío seleccionada no es válida o faltante.');
      }
      

      const snapshot = (items as { documentId: string; quantity: number; price: unknown }[]).map((line) => {
        return {
          documentId: line.documentId,
          quantity: line.quantity,
          priceAtPurchase: parseUnitPrice(line.price),
          name: nameByDocumentId.get(line.documentId) || 'Desconocido',
        };
      });

      // 4. Totales finales
      const grandTotal = (subtotal + shippingCost) * (1 + dynamicTaxRate);
      const amountInCents = Math.round(grandTotal * 100);

      let paymentId = 'transfer_pending';
      let clientSecret = null;

      if (paymentMethod === 'stripe') {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: 'mxn',
          automatic_payment_methods: { enabled: true },
        });
        paymentId = paymentIntent.id;
        clientSecret = paymentIntent.client_secret;
      }

      // 6. Crear la Orden con todos los campos requeridos
      const addr = shippingAddress as Record<string, any>;
      const contactData = contact as Record<string, any>;

      const nuevaOrden = await strapi.documents('api::order.order').create({
        data: {
          orderId: `ORD-${Date.now()}`,
          totalAmount: grandTotal,
          shippingAmount: shippingData.price,
          shippingMethod: `${shippingData.carrier} - ${shippingData.serviceName}`,
          paymentStatusList: 'pending',
          paymentMethod: paymentMethod,
          paymentId,
          productsSnapshot: snapshot,
          firstName: addr.firstName,
          lastName: addr.lastName,
          marketingOptIn: contactData.marketingOptIn || false,
          address: addr.address,
          country: addr.country,
          state: addr.state,
          phone: addr.phone,
          city: addr.city,
          zipCode: addr.zipCode,
          email: contactData.email,
          rateId: String(shippingData.rateId),
          carrier: shippingData.carrier,
          shippingDays: String(shippingData.days),
        } as any,
      });

      // 🚀 7. Si es transferencia, descontamos stock de una vez
      if (paymentMethod === 'transfer') {
        await updateHibridStock(strapi, items);
        
        return ctx.send({
          documentId: nuevaOrden.documentId,
          bankDetails: cartConfig?.bankDetails || 'Datos no configurados'
        });
      }

      ctx.send({
        clientSecret,
        documentId: nuevaOrden.documentId,
      });

    } catch (err) {
      strapi.log.error(err);
      ctx.throw(500, err instanceof Error ? err.message : 'Error interno');
    }
  },

  // 2. Webhook de Stripe
  async confirmPayment(ctx) {
    const event = ctx.request.body as any;

    try {
      if (event?.type === 'payment_intent.succeeded') {
        const paymentIntent = event?.data?.object;
        const stripePaymentId = paymentIntent?.id;
        const meta = paymentIntent?.metadata ?? {};
        const orderDocumentIdFromMeta = meta?.documentId;

        console.log('[confirmPayment] paymentIntent.id (Stripe)', stripePaymentId);
        console.log('[confirmPayment] metadata (Stripe)', meta);
        console.log(
          '[confirmPayment] orderDocumentId desde metadata.documentId',
          orderDocumentIdFromMeta ?? '(no enviado)'
        );

        if (!stripePaymentId) {
          strapi.log.warn('[confirmPayment] payment_intent.succeeded sin paymentIntent.id');
        } else {
          let order: any = null;
          try {
            order = await strapi.documents('api::order.order').findFirst({
              filters: { paymentId: stripePaymentId },
            });
          } catch (error) {
            strapi.log.error(
              `[confirmPayment] Error al buscar orden por paymentId: ${error instanceof Error ? error.message : 'desconocido'}`
            );
          }

          if (!order) {
            strapi.log.warn(`[confirmPayment] Orden no encontrada para paymentId=${stripePaymentId}`);
          } else if (order.paymentStatusList === 'paid') {
            console.log(
              '[confirmPayment] Orden ya en paid (idempotente), documentId:',
              order.documentId
            );
          } else {
            await strapi.documents('api::order.order').update({
              documentId: order.documentId,
              data: { paymentStatusList: 'paid' } as any,
            });

            if (order.paymentMethod === 'stripe') {
              const items = normalizeOrderSnapshotLines(order.productsSnapshot);
              if (items.length > 0) {
                await updateHibridStock(strapi, items);
              }
            }
          }
        }
      }
    } catch (err) {
      strapi.log.error(err);
    }

    return ctx.send({ received: true });
  },

  // 3. Actualizar Dirección (El que faltaba)
  async updateAddress(ctx) {
    const { documentId } = ctx.params;
    const { shippingAddress } = (ctx.request.body as any)?.data || ctx.request.body;
    const userId = ctx.state?.user?.id; // Contexto del usuario logueado

    try {
      const order = await strapi.documents('api::order.order').findOne({
        documentId,
        populate: ['user'] // Asume que la orden se vincula a un user
      }) as any;

      if (!order) return ctx.notFound('Orden no encontrada');
      
      // Validar que la orden no haya sido pagada
      if (order.paymentStatusList === 'paid') {
          return ctx.badRequest('No se puede modificar la dirección de una orden ya pagada.');
      }

      // Proteger que solo el dueño pueda modificar (si hay userId en la orden y en request)
      if (order.user && userId && order.user.id !== userId) {
          return ctx.unauthorized('No tienes permisos para modificar esta orden.');
      }

      const updatedOrder = await strapi.documents('api::order.order').update({
        documentId,
        data: {
          address: shippingAddress?.address,
          city: shippingAddress?.city,
          zipCode: shippingAddress?.zipCode,
          phone: shippingAddress?.phone,
        } as any,
      });

      return ctx.send(updatedOrder);
    } catch (err) {
      strapi.log.error(err);
      return ctx.internalServerError('No se pudo actualizar la dirección');
    }
  },
}));