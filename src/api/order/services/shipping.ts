// src/api/order/services/shipping.ts
import axios from 'axios';

export default {
  async getQuotation(params: { 
    origin_zip: string; 
    destination_zip: string; 
    weight: number; 
    length: number; 
    width: number; 
    height: number; 
  }) {
    try {
      // Sustituye con la URL real de SkydropX o Envia.com
      const response = await axios.post('https://api.skydropx.com/v1/quotations', {
        zip_before: params.origin_zip,
        zip_after: params.destination_zip,
        weight: params.weight,
        width: params.width,
        height: params.height,
        length: params.length
      }, {
        headers: { 
          'Authorization': `Token token=${process.env.SKYDROPX_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error en la cotización de envío:', error.response?.data || error.message);
      throw new Error('No se pudieron obtener tarifas de envío');
    }
  }
};