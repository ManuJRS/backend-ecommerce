import React, { useEffect, useState } from 'react';
import { useFetchClient } from '@strapi/admin/strapi-admin';
import {
  Main,
  Box,
  Flex,
  Typography,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Loader
} from '@strapi/design-system';

const HomePage = () => {
  const { get } = useFetchClient();
  const [stats, setStats] = useState({ 
    totalSales: 0, 
    totalOrders: 0, 
    paidOrders: 0, 
    pendingOrders: 0,
    avgOrderValue: 0,
    abandonmentRate: 0,
    topCities: [] as any[],
    topProducts: [] as any[]
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    get('/store-dashboard/stats')
      .then((res) => {
        setStats(res.data);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error cargando estadísticas:", err);
        setIsLoading(false);
      });
  }, []);

  if (isLoading) return <Loader>Cargando datos del comercio...</Loader>;

  return (
    <Main>
      <Box padding={8} background="neutral100">
        <Typography variant="alpha" as="h1">Dashboard de Negocio</Typography>
      </Box>

      <Box paddingLeft={8} paddingRight={8} paddingBottom={8}>
        
        {/* KPI: Ventas y Métricas de Calidad */}
        <Flex gap={4} marginBottom={6} alignItems="stretch">
          <Box padding={6} hasRadius background="neutral0" shadow="tableShadow" borderStyle="solid" borderWidth="1px" borderColor="success200" style={{ flex: 2 }}>
            <Typography variant="sigma" textColor="neutral600">Ingresos Totales (MXN)</Typography>
            <Typography variant="alpha" display="block" paddingTop={2} textColor="success600">
              ${stats.totalSales.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </Typography>
          </Box>
          
          <Box padding={6} hasRadius background="neutral0" shadow="tableShadow" style={{ flex: 1 }}>
            <Typography variant="sigma" textColor="neutral600">Ticket Promedio</Typography>
            <Typography variant="beta" display="block" paddingTop={2} textColor="secondary600">
              ${stats.avgOrderValue.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </Typography>
          </Box>

          <Box padding={6} hasRadius background="neutral0" shadow="tableShadow" style={{ flex: 1 }}>
            <Typography variant="sigma" textColor="neutral600">Tasa de Abandono</Typography>
            <Typography variant="beta" display="block" paddingTop={2} textColor="danger600">
              {stats.abandonmentRate}%
            </Typography>
          </Box>
        </Flex>

        {/* Conteos rápidos */}
        <Flex gap={4} marginBottom={6}>
          <Box padding={4} hasRadius background="neutral0" shadow="tableShadow" style={{ flex: 1 }}>
            <Typography variant="sigma" textColor="neutral600">Órdenes Totales</Typography>
            <Typography variant="beta" display="block">{stats.totalOrders}</Typography>
          </Box>
          <Box padding={4} hasRadius background="neutral0" shadow="tableShadow" style={{ flex: 1 }}>
            <Typography variant="sigma" textColor="success700">Pagadas</Typography>
            <Typography variant="beta" display="block" textColor="success600">{stats.paidOrders}</Typography>
          </Box>
          <Box padding={4} hasRadius background="neutral0" shadow="tableShadow" style={{ flex: 1 }}>
            <Typography variant="sigma" textColor="warning700">Pendientes</Typography>
            <Typography variant="beta" display="block" textColor="warning600">{stats.pendingOrders}</Typography>
          </Box>
        </Flex>

        {/* Tablas de Ranking */}
        <Flex gap={4} alignItems="flex-start">
          <Box padding={6} hasRadius background="neutral0" shadow="tableShadow" style={{ flex: 2 }}>
            <Typography variant="beta" as="h2" marginBottom={4}>Top 10 Productos</Typography>
            <Table colCount={3} rowCount={stats.topProducts.length}>
              <Thead>
                <Tr>
                  <Th><Typography variant="sigma">Producto</Typography></Th>
                  <Th><Typography variant="sigma">Unidades</Typography></Th>
                  <Th><Typography variant="sigma">Ingresos</Typography></Th>
                </Tr>
              </Thead>
              <Tbody>
                {stats.topProducts.map((p, i) => (
                  <Tr key={i}>
                    <Td><Typography textColor="neutral800">{p.name}</Typography></Td>
                    <Td><Typography textColor="neutral800">{p.quantity}</Typography></Td>
                    <Td><Typography textColor="success600" fontWeight="bold">${p.revenue.toLocaleString('es-MX')}</Typography></Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>

          <Box padding={6} hasRadius background="neutral0" shadow="tableShadow" style={{ flex: 1 }}>
            <Typography variant="beta" as="h2" marginBottom={4}>Top Ciudades</Typography>
            <Flex direction="column" alignItems="stretch" gap={2}>
              {stats.topCities.map((city, i) => (
                <Box key={i} padding={3} background="neutral100" hasRadius>
                  <Flex justifyContent="space-between">
                    <Typography variant="omega" fontWeight="bold">{city.name}</Typography>
                    <Typography variant="omega" textColor="neutral600">{city.count}</Typography>
                  </Flex>
                </Box>
              ))}
            </Flex>
          </Box>
        </Flex>
      </Box>
    </Main>
  );
};

export { HomePage };