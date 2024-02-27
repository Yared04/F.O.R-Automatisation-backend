const prisma = require("../../database");

async function getProducts(req, res) {
  try {
    const { page, pageSize } = req.query;
    const totalCount = await prisma.product.count();

    let products;
    if (page && pageSize) {
      products = await prisma.product.findMany({
        select: {
          id: true,
          name: true,
          category: true,
          unitOfMeasurement: true,
        },
        skip: (page - 1) * parseInt(pageSize, 10),
        take: parseInt(pageSize, 10),
      });
    } else {
      products = await prisma.product.findMany({
        select: {
          id: true,
          name: true,
          category: true,
          unitOfMeasurement: true,
        },
      });
    }

    const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));

    res.json({
      items: products,
      totalCount: totalCount,
      pageSize: parseInt(pageSize, 10),
      currentPage: parseInt(page, 10),
      totalPages: totalPages,
    });
  } catch (error) {
    console.error("Error retrieving products:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function getProductById(req, res) {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: {
        id: id,
      },
    });

    res.json(product);
  } catch (error) {
    console.error("Error retrieving product by id:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function createProduct(req, res) {
  try {
    const { name, category, unitOfMeasurement } = req.body;

    const createdProduct = await prisma.product.create({
      data: {
        name,
        category,
        unitOfMeasurement,
      },
    });

    res.json(createdProduct);
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const { name, category, unitOfMeasurement } = req.body;

    const updatedProduct = await prisma.product.update({
      where: {
        id: id,
      },
      data: {
        name,
        category,
        unitOfMeasurement,
      },
    });

    res.json(updatedProduct);
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function deleteProduct(req, res) {
  try {
    const { id } = req.params;

    const deletedProduct = await prisma.product.delete({
      where: {
        id: id,
      },
    });

    res.send(deletedProduct);
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductById,
};
