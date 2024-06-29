const prisma = require("../../database");
const {
  createTransaction,
} = require("../caTransaction/caTransactionController");
const { deleteSupplierPayment } = require("./supplierPaymentController");

async function getPurchases(req, res) {
  try {
    const { page, pageSize } = req.query;
    const totalCount = await prisma.purchase.count();

    let purchases;
    if (page && pageSize) {
      purchases = await prisma.purchase.findMany({
        select: {
          id: true,
          date: true,
          number: true,
          truckNumber: true,
          exchangeRate: true,
          paymentStatus: true,
          paidAmountETB: true,
          paidAmountUSD: true,
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          products: true,
          transports: true,
          esls: true,
          transits: true,
        },
        orderBy: {
          date: "desc",
        },
        skip: (page - 1) * parseInt(pageSize, 10),
        take: parseInt(pageSize, 10),
      });
    } else {
      purchases = await prisma.purchase.findMany({
        select: {
          id: true,
          date: true,
          number: true,
          truckNumber: true,
          exchangeRate: true,
          paymentStatus: true,
          paidAmountETB: true,
          paidAmountUSD: true,
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          products: true,
          transports: true,
          esls: true,
          transits: true,
        },
      });
    }
    // Recalculate total costs for each purchase
    for (const purchase of purchases) {
      let totalTransportCost = 0;
      let totalEslCost = 0;
      let totalTransitCost = 0;

      // Sum up the costs from associated tables
      for (const transport of purchase.transports) {
        totalTransportCost += transport.cost;
      }

      for (const esl of purchase.esls) {
        totalEslCost += esl.cost;
      }

      for (const transit of purchase.transits) {
        totalTransitCost += transit.cost;
      }

      // Assign the total costs to the purchase
      purchase.totalTransportCost = totalTransportCost;
      purchase.totalEslCost = totalEslCost;
      purchase.totalTransitCost = totalTransitCost;
    }

    const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));

    res.json({
      items: purchases,
      totalCount: totalCount,
      pageSize: parseInt(pageSize, 10),
      currentPage: parseInt(page, 10),
      totalPages: totalPages,
    });
  } catch (error) {
    console.error("Error retrieving Purchases:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function createPurchase(req, res) {
  try {
    const {
      date,
      number,
      truckNumber,
      exchangeRate,
      supplierId,
      transportCost,
      eslCustomCost,
      transitFees,
      purchaseProducts,
    } = req.body;

    let createdPurchase = null;
    const totalPurchaseQuantity = purchaseProducts.reduce(
      (total, productPurchase) =>
        total + parseInt(productPurchase.purchaseQuantity),
      0
    );

    const existingPurchase = await prisma.purchase.findFirst({
      where: {
        number: parseInt(number),
      },
    });

    if (existingPurchase) {
      return res
        .status(400)
        .json({ error: "There is already a purchase by this purchase number" });
    }

    for (product of purchaseProducts) {
      const currentDeclaration = await prisma.productDeclaration.findFirst({
        where: {
          AND: [
            { productId: product.productId },
            { declarationId: product.declarationId },
          ],
        },
      });
      const declarationBalance =
        currentDeclaration.declarationQuantity - product.purchasedQuantity;
      if (declarationBalance < 0) {
        res.status(400).send({
          error: `The purchase quantity for the product ${product.id} is greater than the declaration quantity`,
        });
      }
    }
    createdPurchase = await prisma.purchase.create({
      data: {
        date: new Date(date),
        number: parseInt(number),
        truckNumber,
        exchangeRate: parseFloat(exchangeRate),
        supplier: {
          connect: {
            id: supplierId,
          },
        },
      },
      include: {
        supplier: true,
      },
    });

    const createdProductPurchases = await Promise.all(
      purchaseProducts.map(async (purchaseProduct) => {
        const createdProductPurchase = await prisma.productPurchase.create({
          data: {
            purchase: {
              connect: {
                id: createdPurchase.id,
              },
            },
            declaration: {
              connect: {
                id: purchaseProduct.declarationId,
              },
            },
            product: {
              connect: {
                id: purchaseProduct.productId,
              },
            },
            date: new Date(date),
            purchaseQuantity: parseInt(purchaseProduct.purchaseQuantity),
            remainingQuantity: parseInt(purchaseProduct.purchaseQuantity),
            purchaseUnitPriceETB: exchangeRate
              ? parseFloat(purchaseProduct.purchaseUnitPrice) *
                parseFloat(exchangeRate)
              : parseFloat(purchaseProduct.purchaseUnitPrice),
            purchaseUnitPriceUSD: exchangeRate
              ? parseFloat(purchaseProduct.purchaseUnitPrice)
              : null,
            purchaseTotalETB: exchangeRate
              ? parseInt(purchaseProduct.purchaseQuantity) *
                parseFloat(purchaseProduct.purchaseUnitPrice) *
                parseFloat(exchangeRate)
              : parseInt(purchaseProduct.purchaseQuantity) *
                parseFloat(purchaseProduct.purchaseUnitPrice),
            purchaseUnitCostOfGoods: 0,
          },
          include: {
            declaration: true,
          },
        });

        const currentDeclaration = await prisma.productDeclaration.findFirst({
          where: {
            AND: [
              { productId: purchaseProduct.productId },
              { declarationId: purchaseProduct.declarationId },
            ],
          },
        });
        const p = await prisma.productDeclaration.update({
          where: {
            id: currentDeclaration.id,
          },
          data: {
            purchasedQuantity:
              currentDeclaration.purchasedQuantity +
              parseInt(purchaseProduct.purchaseQuantity),
            declarationBalance:
              currentDeclaration.declarationQuantity -
              (currentDeclaration.purchasedQuantity +
                parseInt(purchaseProduct.purchaseQuantity)),
          },
        });

        return createdProductPurchase;
      })
    );

    let chartOfAccounts = [];
    let suppliers = [];
    try {
      chartOfAccounts = await prisma.chartOfAccount.findMany({
        select: { id: true, name: true },
      });
      suppliers = await prisma.supplier.findMany({
        select: { id: true, name: true },
      });
    } catch {
      throw new Error("Error fetching Chart of Accounts");
    }

    const accountsPayable = chartOfAccounts.find(
      (account) => account.name === "Accounts Payable (A/P) - USD"
    );

    const inventoryAsset = chartOfAccounts.find(
      (account) => account.name === "Inventory Asset"
    );

    const transitCostCA = chartOfAccounts.find(
      (account) => account.name === "Transit fees"
    );

    const transportCostCA = chartOfAccounts.find(
      (account) => account.name === "Import Transport Cost"
    );

    const eslCostCA = chartOfAccounts.find(
      (account) => account.name === "ESL Cost"
    );

    const transitSupplier = suppliers.find(
      (supplier) => supplier.name === "Transit Fees"
    );

    const transportSupplier = suppliers.find(
      (supplier) => supplier.name === "Transporters"
    );

    const eslCustomSupplier = suppliers.find(
      (supplier) => supplier.name === "ESL Custom Warehouse"
    );

    let purchaseTotalAmount = 0;
    let transportCostTotal = 0;
    let eslCustomCostTotal = 0;
    let transitFeesTotal = 0;

    for (const productPurchase of createdProductPurchases) {
      try {
        const transportFee = parseFloat(
          (transportCost * productPurchase.purchaseQuantity) /
            totalPurchaseQuantity
        );
        const eslCustomFee = parseFloat(
          (eslCustomCost * productPurchase.purchaseQuantity) /
            totalPurchaseQuantity
        );
        const transitFee = parseFloat(
          (transitFees * productPurchase.purchaseQuantity) /
            totalPurchaseQuantity
        );

        const transport = await prisma.transport.create({
          data: {
            purchase: {
              connect: {
                id: createdPurchase.id,
              },
            },
            date: createdPurchase.date,
            cost: transportFee,
            unitTransportCost: transportFee / productPurchase.purchaseQuantity,
            type: "Bill",
            productPurchase: {
              connect: {
                id: productPurchase.id,
              },
            },
          },
        });

        await createTransaction(
          transportCostCA.id,
          null,
          new Date(date),
          productPurchase.declaration.number,
          "Bill",
          transportFee,
          null,
          productPurchase.purchaseId,
          productPurchase.id,
          null,
          null,
          transportSupplier.id,
          null,
          null,
          null
        );

        transportCostTotal += transportFee;

        const eslCustom = await prisma.eSL.create({
          data: {
            purchase: {
              connect: {
                id: createdPurchase.id,
              },
            },
            date: createdPurchase.date,
            cost: eslCustomFee,
            unitEslCost: eslCustomFee / productPurchase.purchaseQuantity,
            type: "Bill",
            productPurchase: {
              connect: {
                id: productPurchase.id,
              },
            },
          },
        });

        await createTransaction(
          eslCostCA.id,
          null,
          new Date(date),
          productPurchase.declaration.number,
          "Bill",
          eslCustomFee,
          null,
          productPurchase.purchaseId,
          productPurchase.id,
          null,
          null,
          eslCustomSupplier.id,
          null,
          null,
          null
        );

        eslCustomCostTotal += eslCustomFee;

        const transit = await prisma.transit.create({
          data: {
            purchase: {
              connect: {
                id: createdPurchase.id,
              },
            },
            date: createdPurchase.date,
            cost: transitFee,
            unitTransitCost: transitFee / productPurchase.purchaseQuantity,
            type: "Bill",
            productPurchase: {
              connect: {
                id: productPurchase.id,
              },
            },
          },
        });

        await createTransaction(
          transitCostCA.id,
          null,
          new Date(date),
          productPurchase.declaration.number,
          "Bill",
          transitFee,
          null,
          productPurchase.purchaseId,
          productPurchase.id,
          null,
          null,
          transitSupplier.id,
          null,
          null,
          null
        );

        transitFeesTotal += transitFee;

        const updatedProductPurchase = await prisma.productPurchase.update({
          where: { id: productPurchase.id },
          data: {
            purchaseUnitCostOfGoods:
              (transportFee + eslCustomFee + transitFee) /
                parseInt(productPurchase.purchaseQuantity) +
              parseFloat(productPurchase.purchaseUnitPriceETB),
          },
        });
      } catch (error) {
        console.error("Error creating a product purchase:", error);
        throw new Error(error);
      }

      //check if the product has invetory entries
      let inventoryEntries = [];
      try {
        inventoryEntries = await prisma.inventory.findMany({
          where: {
            productId: productPurchase.productId,
            NOT: {
              AND: [{ purchaseId: null }, { saleId: null }],
            },
          },
          select: {
            balanceQuantity: true,
            purchaseId: true,
            saleId: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      } catch (error) {
        console.error("Error retrieving inventory:", error);
        throw new Error(error);
      }

      //if the product has no inventory entries, create one
      let isNewEntry = false;
      if (!inventoryEntries.length) {
        try {
          const inventory = await prisma.inventory.create({
            data: {
              purchase: {
                connect: {
                  id: productPurchase.purchaseId,
                },
              },
              productPurchase: {
                connect: {
                  id: productPurchase.id,
                },
              },
              product: {
                connect: {
                  id: productPurchase.productId,
                },
              },
              balanceQuantity: productPurchase.purchaseQuantity,
            },
          });
          isNewEntry = true;
          inventoryEntries.push(inventory);
        } catch (error) {
          console.error("Error creating inventory:", error);
          throw new Error(error);
        }
      }

      //get the last purchase and sale entries
      let purchaseEntry = inventoryEntries.find((entry) => entry.purchaseId);
      let saleEntry = inventoryEntries.find((entry) => entry.saleId);

      //create a new inventory entry
      if (!isNewEntry) {
        try {
          await prisma.inventory.create({
            data: {
              purchase: {
                connect: {
                  id: productPurchase.purchaseId,
                },
              },
              productPurchase: {
                connect: {
                  id: productPurchase.id,
                },
              },
              product: {
                connect: {
                  id: productPurchase.productId,
                },
              },
              balanceQuantity: saleEntry
                ? saleEntry.balanceQuantity + productPurchase.purchaseQuantity
                : purchaseEntry.balanceQuantity +
                  productPurchase.purchaseQuantity,
            },
          });
        } catch (error) {
          console.error("Error creating inventory:", error);
          throw new Error(error);
        }
      }

      //create a transaction entry for the debit
      await createTransaction(
        inventoryAsset.id,
        null,
        new Date(date),
        productPurchase.declaration.number,
        "Bill",
        productPurchase.purchaseTotalETB,
        null,
        productPurchase.purchaseId,
        productPurchase.id,
        null,
        null,
        supplierId,
        null,
        null,
        null
      );
      purchaseTotalAmount += productPurchase.purchaseTotalETB;
    }

    //create a transaction entry for the credit
    try {
      await createTransaction(
        accountsPayable.id,
        null,
        new Date(date),
        truckNumber,
        "Bill",
        null,
        purchaseTotalAmount,
        createdPurchase.id,
        null,
        null,
        null,
        supplierId,
        null,
        parseFloat(exchangeRate),
        purchaseTotalAmount / parseFloat(exchangeRate)
      );

      //create a transaction entry for the credit of transport cost
      await createTransaction(
        transportCostCA.id,
        null,
        new Date(date),
        truckNumber,
        "Bill",
        null,
        transportCostTotal,
        createdPurchase.id,
        null,
        null,
        null,
        transportSupplier.id,
        null,
        null,
        null
      );

      //create a transaction entry for the credit of esl cost
      await createTransaction(
        eslCostCA.id,
        null,
        new Date(date),
        truckNumber,
        "Bill",
        null,
        eslCustomCostTotal,
        createdPurchase.id,
        null,
        null,
        null,
        eslCustomSupplier.id,
        null,
        null,
        null
      );

      //create a transaction entry for the credit of transit fees
      await createTransaction(
        transitCostCA.id,
        null,
        new Date(date),
        truckNumber,
        "Bill",
        null,
        transitFeesTotal,
        createdPurchase.id,
        null,
        null,
        null,
        transitSupplier.id,
        null,
        null,
        null
      );
    } catch (error) {
      console.error("Error creating transaction:", error);
      throw new Error(error);
    }

    createdPurchase.totalTransportCost = transportCost;
    createdPurchase.totalEslCost = eslCustomCost;
    createdPurchase.totalTransitCost = transitFees;

    res.json(createdPurchase);
  } catch (error) {
    console.error("Error creating purchase:", error);
    res.status(500).send({ error: error.message });
  }
}

async function getPurchase(id) {
  try {
    const purchase = await prisma.purchase.findUnique({
      where: {
        id: id,
      },
      select: {
        id: true,
        number: true,
        date: true,
        truckNumber: true,
        supplier: true,
      },
    });

    if (!purchase) {
      return { error: "Purchase not found" };
    }

    return purchase;
  } catch (error) {
    console.error("Error retrieving purchase:", error);
    return { error: "Internal Server Error" };
  }
}

async function getProductPurchaseById(id) {
  try {
    const productPurchase = await prisma.productPurchase.findUnique({
      where: {
        id: id,
      },
      select: {
        id: true,
        purchaseQuantity: true,
        purchaseUnitPriceETB: true,
        purchaseUnitPriceUSD: true,
        purchaseTotalETB: true,
        purchaseUnitCostOfGoods: true,
        date: true,
        product: {
          select: {
            id: true,
            name: true,
            category: true,
            unitOfMeasurement: true,
          },
        },
        declaration: {
          select: {
            id: true,
            number: true,
            date: true,
          },
        },
      },
    });
    return productPurchase;
  } catch (error) {
    console.error("Error retrieving product purchase:", error);
    return { error: "Internal Server Error" };
  }
}

async function getProductPurchases(id) {
  try {
    const productPurchases = await prisma.productPurchase.findMany({
      where: {
        purchaseId: id,
      },
      select: {
        id: true,
        purchaseQuantity: true,
        purchaseUnitPriceETB: true,
        purchaseUnitPriceUSD: true,
        purchaseTotalETB: true,
        purchaseUnitCostOfGoods: true,
        product: {
          select: {
            id: true,
            name: true,
            category: true,
            unitOfMeasurement: true,
          },
        },
        declaration: {
          select: {
            id: true,
            number: true,
            date: true,
          },
        },
      },
    });
    return productPurchases;
  } catch (error) {
    console.error("Error retrieving product purchase:", error);
    return { error: "Internal Server Error" };
  }
}

async function getPurchaseById(req, res) {
  try {
    const { id } = req.params;
    const purchase = await getPurchase(id);
    const productPurchases = await getProductPurchases(id);

    res.json({ ...purchase, productPurchases });
  } catch (error) {
    console.error("Error: ", error);
    res.status(500).send(error.message);
  }
}

async function updatePurchase(req, res) {
  try {
    const {
      date,
      number,
      truckNumber,
      supplierId,
      transportCost,
      eslCustomCost,
      transitFees,
    } = req.body;

    const { id } = req.params;

    const purchase = await prisma.purchase.findFirst({
      where: {
        number: number,
      },
    });

    if (purchase && purchase.id !== id) {
      return res
        .status(400)
        .json({ error: "There is already a purchase by this purchase number" });
    }

    // Check if the purchase exists
    const existingPurchase = await prisma.purchase.findUnique({
      where: {
        id: id,
      },
      include: {
        products: true,
        transports: true,
        esls: true,
        transits: true,
      },
    });

    if (!existingPurchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    // Calculate total purchase quantity
    const totalPurchaseQuantity = existingPurchase.products.reduce(
      (total, productPurchase) =>
        total + parseInt(productPurchase.purchaseQuantity),
      0
    );

    // Update the purchase
    const updatedPurchase = await prisma.purchase.update({
      where: {
        id: id,
      },
      data: {
        date: new Date(date),
        number: parseInt(number),
        truckNumber,
        supplier: {
          connect: {
            id: supplierId,
          },
        },
      },
      include: {
        supplier: true,
      },
    });

    // Recalculate transport costs
    if (existingPurchase.transports.length > 0) {
      await Promise.all(
        existingPurchase.transports.map(async (transport) => {
          const productPurchase = await prisma.productPurchase.findUnique({
            where: {
              id: transport.productPurchaseId,
            },
          });
          const recalculatedTransportCost = parseFloat(
            (transportCost * productPurchase.purchaseQuantity) /
              totalPurchaseQuantity
          );
          await prisma.transport.update({
            where: {
              id: transport.id,
            },
            data: {
              cost: recalculatedTransportCost,
            },
          });
        })
      );
    }

    // Recalculate ESL costs
    if (existingPurchase.esls.length > 0) {
      await Promise.all(
        existingPurchase.esls.map(async (esl) => {
          const productPurchase = await prisma.productPurchase.findUnique({
            where: {
              id: esl.productPurchaseId,
            },
          });
          const recalculatedEslCustomCost = parseFloat(
            (eslCustomCost * productPurchase.purchaseQuantity) /
              totalPurchaseQuantity
          );
          await prisma.ESL.update({
            where: {
              id: esl.id,
            },
            data: {
              cost: recalculatedEslCustomCost,
            },
          });
        })
      );
    }

    // Recalculate transit fees
    if (existingPurchase.transits.length > 0) {
      await Promise.all(
        existingPurchase.transits.map(async (transit) => {
          const productPurchase = await prisma.productPurchase.findUnique({
            where: {
              id: transit.productPurchaseId,
            },
          });
          const recalculatedTransitFees = parseFloat(
            (transitFees * productPurchase.purchaseQuantity) /
              totalPurchaseQuantity
          );
          await prisma.transit.update({
            where: {
              id: transit.id,
            },
            data: {
              cost: recalculatedTransitFees,
            },
          });
        })
      );
    }

    updatedPurchase.totalTransportCost = transportCost;
    updatedPurchase.totalEslCost = eslCustomCost;
    updatedPurchase.totalTransitCost = transitFees;

    res.json(updatedPurchase);
  } catch (error) {
    console.error("Error updating purchase:", error);
    res.status(500).send({ error: error.message });
  }
}

async function deletePurchase(req, res) {
  try {
    const { id } = req.params;
    //check if there is a sale Detail for the purchase
    const saleDetail = await prisma.saleDetail.findFirst({
      where: {
        purchaseId: id,
      },
    });

    if (saleDetail) {
      return res.status(400).json({
        error:
          "Cannot delete purchase with associated sale, Please delete the sale first.",
      });
    }

    const productPurchases = await prisma.productPurchase.findMany({
      where: {
        purchaseId: id,
      },
    });

    if (productPurchases.length === 0) {
      const deleted = await deleteSupplierPayment(id);
      res.json(deleted);
      return;
    }

    for (let productPurchase of productPurchases) {
      const currentDeclaration = await prisma.productDeclaration.findFirst({
        where: {
          AND: [
            { productId: productPurchase.productId },
            { declarationId: productPurchase.declarationId },
          ],
        },
      });

      await prisma.productDeclaration.update({
        where: {
          id: currentDeclaration.id,
        },
        data: {
          purchasedQuantity:
            currentDeclaration.purchasedQuantity -
            parseInt(productPurchase.purchaseQuantity),
          declarationBalance:
            currentDeclaration.declarationQuantity -
            (currentDeclaration.purchasedQuantity -
              parseInt(productPurchase.purchaseQuantity)),
        },
      });

      const inventoryEntry = await prisma.inventory.findMany({
        where: {
          purchaseId: id,
        },
      });

      inventoryEntry.length > 0 &&
        (await prisma.inventory.deleteMany({
          where: {
            id: inventoryEntry[0].id,
          },
        }));

      const caTransactions = await prisma.CATransaction.findMany({
        where: {
          productPurchaseId: productPurchase.id,
        },
      });

      for (let caTransaction of caTransactions) {
        await prisma.CATransaction.delete({
          where: {
            id: caTransaction.id,
          },
        });
      }

      await prisma.productPurchase.delete({
        where: {
          id: productPurchase.id,
        },
      });
    }

    const deletedPurchase = await prisma.purchase.delete({
      where: { id: id },
    });

    res.json(deletedPurchase);
  } catch (error) {
    console.error("Error deleting purchase:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function getTransportCosts(req, res) {
  try {
    const { page, pageSize } = req.query;
    const totalCount = await prisma.transport.count();

    let transports;
    if (page && pageSize) {
      transports = await prisma.transport.findMany({
        select: {
          id: true,
          date: true,
          cost: true,
          type: true,
          purchase: true,
          paymentStatus: true,
          productPurchase: {
            select: {
              declaration: true,
            },
          },
          paidAmount: true,
          unitTransportCost: true,
        },
        orderBy: {
          date: "desc",
        },
        skip: (page - 1) * parseInt(pageSize, 10),
        take: parseInt(pageSize, 10),
      });
    } else {
      transports = await prisma.transport.findMany({
        select: {
          id: true,
          date: true,
          cost: true,
          type: true,
          purchase: true,
          paymentStatus: true,
          productPurchase: {
            select: {
              declaration: true,
            },
          },
          paidAmount: true,
        },
      });
    }

    const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));

    res.json({
      items: transports,
      totalCount: totalCount,
      pageSize: parseInt(pageSize, 10),
      currentPage: parseInt(page, 10),
      totalPages: totalPages,
    });
  } catch (error) {
    console.error("Error retrieving transport costs:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function getEslCosts(req, res) {
  try {
    const { page, pageSize } = req.query;
    const totalCount = await prisma.ESL.count();

    let esls;
    if (page && pageSize) {
      esls = await prisma.ESL.findMany({
        select: {
          id: true,
          date: true,
          cost: true,
          type: true,
          purchase: true,
          productPurchase: {
            select: {
              declaration: true,
            },
          },
          paidAmount: true,
          paymentStatus: true,
          unitEslCost: true,
        },
        orderBy: {
          date: "desc",
        },
        skip: (page - 1) * parseInt(pageSize, 10),
        take: parseInt(pageSize, 10),
      });
    } else {
      esls = await prisma.ESL.findMany({
        select: {
          id: true,
          date: true,
          cost: true,
          type: true,
          purchase: true,
          productPurchase: {
            select: {
              declaration: true,
            },
          },
          paidAmount: true,
        },
      });
    }

    const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));

    res.json({
      items: esls,
      totalCount: totalCount,
      pageSize: parseInt(pageSize, 10),
      currentPage: parseInt(page, 10),
      totalPages: totalPages,
    });
  } catch (error) {
    console.error("Error retrieving esl costs:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function getTransiFees(req, res) {
  try {
    const { page, pageSize } = req.query;
    const totalCount = await prisma.transit.count();

    let transitFees;
    if (page && pageSize) {
      transitFees = await prisma.transit.findMany({
        select: {
          id: true,
          date: true,
          cost: true,
          type: true,
          purchase: true,
          productPurchase: {
            select: {
              declaration: true,
            },
          },
          paidAmount: true,
          paymentStatus: true,
          unitTransitCost: true,
        },
        orderBy: {
          date: "desc",
        },
        skip: (page - 1) * parseInt(pageSize, 10),
        take: parseInt(pageSize, 10),
      });
    } else {
      transitFees = await prisma.transit.findMany({
        select: {
          id: true,
          date: true,
          cost: true,
          type: true,
          purchase: true,
          productPurchase: {
            select: {
              declaration: true,
            },
          },
          paidAmount: true,
        },
      });
    }

    const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));

    res.json({
      items: transitFees,
      totalCount: totalCount,
      pageSize: parseInt(pageSize, 10),
      currentPage: parseInt(page, 10),
      totalPages: totalPages,
    });
  } catch (error) {
    console.error("Error retrieving transit fees:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function getPurchaseWaybillNumber(req, res) {
  try {
    const waybillNumber = await prisma.purchase.findFirst({
      select: {
        number: true,
      },
      orderBy: {
        number: "desc",
      },
    });
    const result = waybillNumber?.number? ++waybillNumber.number: 1
    res.json(result);
  } catch (error) {
    console.error("Error: ", error);
    res.status(500).send(error.message);
  }
}

module.exports = {
  getPurchases,
  createPurchase,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  getPurchase,
  getProductPurchases,
  getProductPurchaseById,
  getTransportCosts,
  getEslCosts,
  getTransiFees,
  getPurchaseWaybillNumber,
};
