const prisma = require("../../database");

async function getDeclarations(req, res) {
  try {
    const { page = 1, pageSize = 10 } = req.query;

    if (page && pageSize) {
      const totalCount = await prisma.declaration.count();

      const declarations = await prisma.declaration.findMany({
        select: {
          id: true,
          number: true,
          date: true,
        },
        skip: (page - 1) * parseInt(pageSize, 10),
        take: parseInt(pageSize, 10),
      });

      const declarationsWithProducts = await Promise.all(
        declarations.map(async (declaration) => {
          const declarationProducts = await prisma.productDeclaration.findMany({
            where: {
              declarationId: declaration.id,
            },
            select: {
              declarationQuantity: true,
              totalIncomeTax: true,
              unitIncomeTax: true,
              purchasedQuantity: true,
              declarationBalance: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  unitOfMeasurement: true,
                },
              },
            },
          });
          return { ...declaration, declarationProducts };
        })
      );

      const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));
      return res.json({
        items: declarationsWithProducts,
        totalCount: totalCount,
        pageSize: parseInt(pageSize, 10),
        currentPage: parseInt(page, 10),
        totalPages: totalPages,
      });
    } else {
      // Fetch all declarations without pagination
      const allDeclarations = await prisma.declaration.findMany({
        select: {
          id: true,
          number: true,
          date: true,
        },
      });

      const allDeclarationsWithProducts = await Promise.all(
        allDeclarations.map(async (declaration) => {
          const declarationProducts = await prisma.productDeclaration.findMany({
            where: {
              declarationId: declaration.id,
            },
            select: {
              declarationQuantity: true,
              totalIncomeTax: true,
              unitIncomeTax: true,
              purchasedQuantity: true,
              declarationBalance: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  unitOfMeasurement: true,
                },
              },
            },
          });
          return { ...declaration, declarationProducts };
        })
      );

      return res.json({
        items: allDeclarationsWithProducts,
        totalCount: allDeclarations.length,
      });
    }
  } catch (error) {
    console.error("Error retrieving declarations:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function createDeclaration(req, res) {
  try {
    const { number, date, declarationProducts } = req.body;
    const existingDeclaration = await prisma.declaration.findFirst({
      where:{
        number: number
      }
    })

    if(existingDeclaration){
      return res
      .status(400)
      .json({error: 'There is already a declaration by this declaration number'});
    }
    const createdDeclaration = await prisma.declaration.create({
      data: {
        number,
        date: new Date(date),
      },
    });
    const createdDeclarationProducts = await Promise.all(
      declarationProducts.map(async (dp) => {
        let createdDeclarationProduct = await prisma.productDeclaration.create({
          data: {
            declarationQuantity: parseInt(dp.declarationQuantity),
            totalIncomeTax: parseInt(dp.totalIncomeTax),
            unitIncomeTax: dp.totalIncomeTax / dp.declarationQuantity,
            purchasedQuantity: 0,
            product: { connect: { id: dp.productId } },
            declaration: { connect: { id: createdDeclaration.id } },
          },
        });
        return {
          productId: dp.productId,
          declarationQuantity: createdDeclarationProduct.declarationQuantity,
          totalIncomeTax: createdDeclarationProduct.totalIncomeTax,
          purchasedQuantity: createdDeclarationProduct.purchasedQuantity,
          declarationBalance: createdDeclarationProduct.declarationBalance,
          unitIncomeTax: createdDeclarationProduct.unitIncomeTax,
        };
      })
    );

    const declarationData = {
      id: createdDeclaration.id.toString(),
      number,
      date,
      declarationProducts: createdDeclarationProducts,
    };

    res.json(declarationData);
  } catch (error) {
    console.error("Error creating declaration:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function updateDeclaration(req, res) {
  try {
    const { id } = req.params; // Extract the declaration ID from request parameters
    const { number, date} = req.body; // Extract updated data from request body

    const existingDeclaration = await prisma.declaration.findFirst({
      where:{
        number: number
      }
    })

    if((existingDeclaration) && existingDeclaration.id !== id){
      return res
      .status(400)
      .json({error: 'There is already a declaration by this declaration number'});
    }

    // Update the Declaration
    const updatedDeclaration = await prisma.declaration.update({
      where: { id: id }, // Convert id to integer if needed
      data: {
        number,
        date: new Date(date),
      }
    });

    res.json(updatedDeclaration);
  } catch (error) {
    console.error("Error updating declaration:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function deleteDeclaration(req, res) {
  try {
    const { id } = req.params; // Extract the declaration ID from request parameters

    const hasAssociatedPurchases = await prisma.productPurchase.findFirst({
      where: {
        declarationId: id,
      },
    });

    if (hasAssociatedPurchases) {
      // Return a specific message indicating associated purchases exist
      return res.status(400).json({
        error: "You cannot delete this declaration. Associated purchases exist.",
      });
    }
    // Delete the associated product declarations
    await prisma.productDeclaration.deleteMany({
      where: {
        declarationId: id,
      },
    });

    // Delete the declaration
    const deletedDeclaration = await prisma.declaration.delete({
      where: {
        id: id,
      },
    });

    res.json(deletedDeclaration);
  } catch (error) {
    console.error("Error deleting declaration:", error);
    res.status(500).send("Internal Server Error");
  }
}


async function getDeclarationById(req, res) {
  try {
    const { id } = req.params; // Extract the declaration ID from request parameters
    const declaration = await prisma.declaration.findUnique({
      where: {
        id: id, // Convert id to integer if needed
      },
      select: {
        id: true,
        number: true,
        date: true,
      },
    });

    if (!declaration) {
      return res.status(404).json({ error: "Declaration not found" });
    }

    // Retrieve associated products for the declaration
    const declarationProducts = await prisma.productDeclaration.findMany({
      where: {
        declarationId: id, // Convert id to integer if needed
      },
      select: {
        id: true,
        declarationQuantity: true,
        totalIncomeTax: true,
        unitIncomeTax: true,
        purchasedQuantity: true,
        declarationBalance: true,
        product: {
          select: {
            id: true,
            name: true,
            category: true,
            unitOfMeasurement: true,
          },
        },
      },
    });

    // Combine declaration data with associated products
    const declarationWithProducts = { ...declaration, declarationProducts };

    res.json(declarationWithProducts);
  } catch (error) {
    console.error("Error retrieving declaration by ID:", error);
    res.status(500).send("Internal Server Error");
  }
}


async function updateProductDeclaration(req, res) {
  try {
    const { id } = req.params; // Extract the productDeclaration ID from request parameters
    const { declarationQuantity, totalIncomeTax, productId } = req.body; // Extract updated data from request body

    // Fetch the existing product declaration
    const existingProductDeclaration = await prisma.productDeclaration.findUnique({
      where: { id: id },
    });

    if (!existingProductDeclaration) {
      return res.status(404).json({ error: "Product declaration not found" });
    }

    // Check if purchased quantity is 0
    if (existingProductDeclaration.purchasedQuantity !== 0) {
      return res.status(400).json({ error: "Product declaration cannot be updated because purchased quantity is not 0" });
    }

    // Calculate unitIncomeTax based on totalIncomeTax and declarationQuantity
    const unitIncomeTax = parseFloat(totalIncomeTax) / parseFloat(declarationQuantity);

    // Update the ProductDeclaration
    const updatedProductDeclaration = await prisma.productDeclaration.update({
      where: { id: id },
      data: {
        declarationQuantity: parseInt(declarationQuantity),
        totalIncomeTax: parseInt(totalIncomeTax),
        unitIncomeTax: unitIncomeTax,
        product: { connect: { id: productId } }, // Assuming product object has an 'id' field
      },include:{
        product:true
      }
    });

    res.json(updatedProductDeclaration);
  } catch (error) {
    console.error("Error updating product declaration:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function deleteProductDeclaration(req, res) {
  try {
    const { id } = req.params; // Extract the productDeclaration ID from request parameters

    // Fetch the existing product declaration
    const existingProductDeclaration = await prisma.productDeclaration.findUnique({
      where: { id: id },
    });

    if (!existingProductDeclaration) {
      return res.status(404).json({ error: "Product declaration not found" });
    }

    // Check if purchased quantity is 0
    if (existingProductDeclaration.purchasedQuantity !== 0) {
      return res.status(400).json({ error: "Product declaration cannot be deleted because purchased quantity is not 0" });
    }

    const declarationProducts = await prisma.productDeclaration.findMany({
      where:{declarationId: existingProductDeclaration.declarationId}
    })

    if(declarationProducts.length == 1){
      return res.status(400).json({ error: "There should atleast be one product in a declaration." });
    }

    // Delete the ProductDeclaration
    const deletedProductDeclaration = await prisma.productDeclaration.delete({
      where: { id: id },
    });

    res.json(deletedProductDeclaration);
  } catch (error) {
    console.error("Error deleting product declaration:", error);
    res.status(500).send("Internal Server Error");
  }
}


async function createProductDeclaration(req, res) {
  try {
    const { declarationQuantity, totalIncomeTax, productId, declarationId } = req.body; // Extract updated data from request body

    // Calculate unitIncomeTax based on totalIncomeTax and declarationQuantity
    const unitIncomeTax = parseFloat(totalIncomeTax) / parseFloat(declarationQuantity);

    // Update the ProductDeclaration
    const productDeclaration = await prisma.productDeclaration.create({
      data: {
        declarationQuantity: parseInt(declarationQuantity),
        totalIncomeTax: parseInt(totalIncomeTax),
        unitIncomeTax: unitIncomeTax,
        purchasedQuantity: 0,
        product: { connect: { id: productId } },
        declaration: { connect: { id: declarationId } },
      }, include:{
        product: true
      }
    });

    res.json(productDeclaration);
  } catch (error) {
    console.error("Error creating product declaration:", error);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  getDeclarationById,
  updateDeclaration,
  getDeclarations,
  createDeclaration,
  deleteDeclaration,
  updateProductDeclaration,
  deleteProductDeclaration,
  createProductDeclaration
};
