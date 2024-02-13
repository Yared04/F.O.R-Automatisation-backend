const express = require('express');
const userRoutes = require('./routes/auth/useRoutes');
const roleRoutes = require('./routes/auth/roleRoutes');
const driverRoutes = require('./routes/driver/driverRoutes');
const productRoutes = require('./routes/product/productRoutes');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger'); 
const cors = require('cors');


const app = express();
app.use(cors());

app.use(express.json());
app.use('/api', userRoutes);
app.use('/api', roleRoutes);
app.use('/api', productRoutes);

app.use('/api', driverRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

module.exports = app;
