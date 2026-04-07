module.exports = {
    async beforeCreate(event) {
        const { data } = event.params;

        if (data.price) {
            const discount = data.discountPercentage || 0;
            // Calculamos y asignamos el valor al nuevo campo automáticamente
            data.discountedPrice = data.price - (data.price * (discount / 100));
        }
    },

    async beforeUpdate(event) {
        const { data, where } = event.params;

        // Solo recalculamos si el usuario modificó el precio o el porcentaje en esta edición
        if (data.price !== undefined || data.discountPercentage !== undefined) {

            // Strapi envía solo los campos editados, así que buscamos el producto original para tener el panorama completo
            const existingProduct = await strapi.db.query('api::product.product').findOne({
                where: { id: where.id }
            });

            // Tomamos el valor nuevo (si lo editaron) o el que ya estaba en la base de datos
            const currentPrice = data.price !== undefined ? data.price : existingProduct.price;
            const currentDiscount = data.discountPercentage !== undefined ? data.discountPercentage : (existingProduct.discountPercentage || 0);

            // Calculamos y sobrescribimos el campo
            data.discountedPrice = currentPrice - (currentPrice * (currentDiscount / 100));
        }
    }
};