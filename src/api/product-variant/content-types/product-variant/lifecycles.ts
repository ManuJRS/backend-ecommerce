type UnknownRecord = Record<string, unknown>;

function parsePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

/** Acepta 0 o positivo; null si no es numérico válido */
function parseNonNegativeNumber(value: unknown): number | null {
  const n = parsePositiveNumber(value);
  if (n === null) return null;
  if (n < 0) return null;
  return n;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Si price > 0 y variantDiscount > 0: precio con descuento.
 * Si variantDiscount es 0 o nulo: copia el precio original.
 */
function applyVariantPriceWithDiscount(
  data: UnknownRecord,
  price: number,
  variantDiscount: number | null
) {
  if (price > 0 && variantDiscount !== null && variantDiscount > 0) {
    data.variantPriceWithDiscount = round2(price * (1 - variantDiscount / 100));
  } else {
    data.variantPriceWithDiscount = round2(price);
  }
}

async function getExistingVariant(where: UnknownRecord) {
  return strapi.db.query('api::product-variant.product-variant').findOne({
    where,
    select: ['price', 'variantDiscount'],
  });
}

module.exports = {
  async beforeCreate(event: { params: { data?: UnknownRecord } }) {
    const data = event.params.data;
    if (!data) return;

    const price = parsePositiveNumber(data.price);
    if (price === null || price <= 0) {
      return;
    }

    let discount: number | null = null;
    if (
      data.variantDiscount !== undefined &&
      data.variantDiscount !== null &&
      data.variantDiscount !== ''
    ) {
      discount = parseNonNegativeNumber(data.variantDiscount);
      if (discount === null) {
        data.variantPriceWithDiscount = round2(price);
        return;
      }
    } else {
      discount = 0;
    }

    applyVariantPriceWithDiscount(data, price, discount > 0 ? discount : 0);
  },

  async beforeUpdate(event: { params: { data?: UnknownRecord; where?: UnknownRecord } }) {
    const data = event.params.data;
    const where = event.params.where;
    if (!data || !where) return;

    if (data.price === undefined && data.variantDiscount === undefined) {
      return;
    }

    const existing = await getExistingVariant(where);

    const price =
      data.price !== undefined
        ? parsePositiveNumber(data.price)
        : parsePositiveNumber(existing?.price);
    if (price === null || price <= 0) {
      return;
    }

    let discount: number | null;
    if (data.variantDiscount !== undefined) {
      if (data.variantDiscount === null || data.variantDiscount === '') {
        discount = 0;
      } else {
        const parsed = parseNonNegativeNumber(data.variantDiscount);
        if (parsed === null) {
          data.variantPriceWithDiscount = round2(price);
          return;
        }
        discount = parsed;
      }
    } else {
      discount = parseNonNegativeNumber(existing?.variantDiscount);
      if (discount === null) {
        discount = 0;
      }
    }

    applyVariantPriceWithDiscount(data, price, discount > 0 ? discount : 0);
  },
};
