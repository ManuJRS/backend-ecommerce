import type { Core } from '@strapi/strapi';

const service = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getStats() {
    try {
      const orders = await strapi.documents('api::order.order').findMany({
        status: 'published',
      });

      if (!orders || orders.length === 0) {
        return { totalSales: 0, totalOrders: 0, paidOrders: 0, pendingOrders: 0, avgOrderValue: 0, abandonmentRate: 0, topCities: [], topProducts: [] };
      }

      // --- 1. Cálculos Básicos ---
      const totalOrders = orders.length;
      const paidOrdersList = orders.filter((o: any) => o.status?.toLowerCase() === 'paid');
      const paidOrdersCount = paidOrdersList.length;
      const pendingOrdersCount = orders.filter((o: any) => o.status?.toLowerCase() === 'pending').length;
      const stateMap: Record<string, number> = {};
      paidOrdersList.forEach((o: any) => {
        const stateName = o.state?.trim() || 'No especificado';
        stateMap[stateName] = (stateMap[stateName] || 0) + 1;
      });

      const totalSales = paidOrdersList.reduce((acc, o: any) => acc + (Number(o.totalAmount) || 0), 0);
      const topStates = Object.entries(stateMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Tomamos el Top 10

      // --- 2. Ticket Promedio (AOV) ---
      const avgOrderValue = paidOrdersCount > 0 ? totalSales / paidOrdersCount : 0;

      // --- 3. Tasa de Abandono (%) ---
      const abandonmentRate = totalOrders > 0 ? (pendingOrdersCount / totalOrders) * 100 : 0;

      // --- 4. Top 5 Ciudades (Agrupación) ---
      const cityMap: Record<string, number> = {};
      paidOrdersList.forEach((o: any) => {
        const city = o.city?.trim() || 'No especificada';
        cityMap[city] = (cityMap[city] || 0) + 1;
      });

      const topCities = Object.entries(cityMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const productMap: Record<string, { name: string; quantity: number; revenue: number }> = {};
      orders.forEach((order: any) => {
        // Solo contamos productos de órdenes pagadas para el Top 10
        if (order.status?.toLowerCase() === 'paid' && Array.isArray(order.productsSnapshot)) {
          order.productsSnapshot.forEach((product: any) => {
            // Usamos el name o el documentId como llave
            const key = product.name || product.documentId || 'Producto Desconocido';
            
            if (!productMap[key]) {
              productMap[key] = { 
                name: key, 
                quantity: 0, 
                revenue: 0 
              };
            }
            
            productMap[key].quantity += (product.quantity || 0);
            productMap[key].revenue += (product.quantity * (product.priceAtPurchase || 0));
          });
        }
      });

      const topProducts = Object.values(productMap).sort((a, b) => b.quantity - a.quantity).slice(0, 10);
      return {
        totalSales: parseFloat(totalSales.toFixed(2)),
        totalOrders,
        paidOrders: paidOrdersCount,
        pendingOrders: pendingOrdersCount,
        avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
        abandonmentRate: parseFloat(abandonmentRate.toFixed(1)),
        topCities,
        topStates,
        topProducts
      };
    } catch (error) {
      console.error("Error en Dashboard Service:", error);
      return { totalSales: 0, totalOrders: 0, paidOrders: 0, pendingOrders: 0, avgOrderValue: 0, abandonmentRate: 0, topCities: [], topProducts: [] };
    }
  },
});

export default service;