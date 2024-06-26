const express = require('express');
const productController = require('../../controllers/product/productController');
const productCategoryController = require('../../controllers/product/productCategoryController');
const unitOfMeasurementController = require('../../controllers/product/unitOfMeasurementController');
const authenticate = require('../../middlewares/authenticate');

const router = express.Router();
router.use(authenticate);

router.get('/products', (req, res) => {
  req.requiredPermissions = ['GetProducts'];
  authenticate(req, res, () => productController.getProducts(req, res));
});

router.post('/products', (req, res) => {
  req.requiredPermissions = ['CreateProduct'];
  authenticate(req, res, () => productController.createProduct(req, res));
});

router.put('/products/:id', (req, res) => {
  req.requiredPermissions = ['UpdateProduct'];
  authenticate(req, res, () => productController.updateProduct(req, res));
});

router.delete('/products/:id', (req, res) => {
  req.requiredPermissions = ['DeleteProduct'];
  authenticate(req, res, () => productController.deleteProduct(req, res));
});

router.get('/products/:id', (req, res) => {
  req.requiredPermissions = ['GetProductById'];
  authenticate(req, res, () => productController.getProductById(req, res));
});

router.get('/product-categories', (req, res) => {
  req.requiredPermissions = ['GetProductCategories'];
  authenticate(req, res, () => productCategoryController.getProductCategories(req, res));
});

router.post('/product-categories', (req, res) => {
  req.requiredPermissions = ['CreateProductCategory'];
  authenticate(req, res, () => productCategoryController.createProductCategory(req, res));
});

router.put('/product-categories/:id', (req, res) => {
  req.requiredPermissions = ['UpdateProductCategory'];
  authenticate(req, res, () => productCategoryController.updateProductCategory(req, res));
});

router.delete('/product-categories/:id', (req, res) => {
  req.requiredPermissions = ['DeleteProductCategory'];
  authenticate(req, res, () => productCategoryController.deleteProductCategory(req, res));
});

router.get('/unit-of-measurements', (req, res) => {
  req.requiredPermissions = ['GetUnitOfMeasurements'];
  authenticate(req, res, () => unitOfMeasurementController.getUnitOfMeasurements(req, res));
});

router.post('/unit-of-measurements', (req, res) => {
  req.requiredPermissions = ['CreateUnitOfMeasurement'];
  authenticate(req, res, () => unitOfMeasurementController.createUnitOfMeasurement(req, res));
});

router.put('/unit-of-measurements/:id', (req, res) => {
  req.requiredPermissions = ['UpdateUnitOfMeasurement'];
  authenticate(req, res, () => unitOfMeasurementController.updateUnitOfMeasurement(req, res));
});

router.delete('/unit-of-measurements/:id', (req, res) => {
  req.requiredPermissions = ['DeleteUnitOfMeasurement'];
  authenticate(req, res, () => unitOfMeasurementController.deleteUnitOfMeasurement(req, res));
});

module.exports = router;
