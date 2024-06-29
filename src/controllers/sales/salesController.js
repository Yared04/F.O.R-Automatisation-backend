const prisma = require("../../database");
const {
  createTransaction,
} = require("../caTransaction/caTransactionController");
const {
  deleteCustomerPayment,
} = require("../caTransaction/customerPaymentController");

async function getSales(req, res) {
  try {
    const { page, pageSize } = req.query;
    const totalCount = await prisma.sale.count();

    let sales;
    if (page && pageSize) {
      sales = await prisma.sale.findMany({
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          customer: true,
          paymentStatus: true,
          sales: true,
          paidAmount: true,
        },
        orderBy: {
          invoiceDate: "desc",
        },

        skip: (page - 1) * parseInt(pageSize, 10),
        take: parseInt(pageSize, 10),
      });
    } else {
      sales = await prisma.sale.findMany({
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          customer: true,
          paymentStatus: true,
          sales: true,
          paidAmount: true,
        },
        orderBy: {
          invoiceDate: "desc",
        },
      });
    }

    const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));

    res.json({
      items: sales,
      totalCount: totalCount,
      pageSize: parseInt(pageSize, 10),
      currentPage: parseInt(page, 10),
      totalPages: totalPages,
    });
  } catch (error) {
    console.error("Error retrieving Sales:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function createSale(req, res) {
  try {
    const { invoiceNumber, invoiceDate, customerId, products } = req.body;
    let createdSale = null;
    let saleId = null;
    let saleTotalAmount = 0;
    let chartOfAccounts = [];
    try {
      chartOfAccounts = await prisma.chartOfAccount.findMany({
        select: { id: true, name: true },
      });
    } catch {
      throw new Error("Error fetching Chart of Accounts");
    }

    const saleOfProductIncome = chartOfAccounts.find(
      (account) => account.name === "Sales of Product Income"
    );

    const accountsReceivable = chartOfAccounts.find(
      (account) => account.name === "Accounts Receivable (A/R)"
    );

    const costOfSales = chartOfAccounts.find(
      (account) => account.name === "Cost of sales"
    );

    const inventoryAsset = chartOfAccounts.find(
      (account) => account.name === "Inventory Asset"
    );

    for (const product of products) {
      let availableProducts = [];
      try {
        availableProducts = await prisma.productPurchase.findMany({
          where: {
            productId: product.productId,
            NOT: {
              purchaseId: null,
            },
          },
          orderBy: [{ date: "asc" }, { purchaseQuantity: "desc" }],
          select: {
            id: true,
            purchaseQuantity: true,
            remainingQuantity: true,
            declarationId: true,
            purchaseId: true,
            productId: true,
            purchaseUnitCostOfGoods: true,
            transit: true,
            transport: true,
            esl: true,
            purchaseUnitPriceETB: true,
          },
        });
      } catch (error) {
        console.error("Error retrieving available products:", error);
        throw new Error("Internal Server Error");
      }
      //calculate the total amount of products available for sale
      const totalPurchaseQuantity = availableProducts.reduce(
        (acc, item) => acc + item.remainingQuantity,
        0
      );

      //Define how many products are to be sold
      let remainingSaleQuantity = parseInt(product.saleQuantity);
      let productPurchaseIndex = 0;

      //if the total amount of products available for sale is less than the amount to be sold, return an error
      if (remainingSaleQuantity > totalPurchaseQuantity) {
        throw new Error("Not Engough Products for Sale!");
      }
      if (createdSale === null) {
        try {
          createdSale = await prisma.sale.create({
            data: {
              invoiceNumber: parseInt(invoiceNumber),
              invoiceDate: new Date(invoiceDate),
              customer: {
                connect: { id: customerId },
              },
            },
            include: {
              customer: true,
            },
          });
        } catch (error) {
          console.error("Error creating sale:", error);
          throw new Error("Internal Server Error");
        }
      }
      saleId = createdSale.id;
      let sale = null;
      let productTotal = 0;
      let inventoryBalance = 0;
      while (remainingSaleQuantity > 0) {
        const productPurchase = availableProducts[productPurchaseIndex];
        if (productPurchase.remainingQuantity === 0) {
          productPurchaseIndex += 1;
          continue;
        }

        let productDeclaration;
        //Find the declaration with the which the product was declared on
        try {
          productDeclaration = await prisma.productDeclaration.findFirst({
            where: {
              productId: productPurchase.productId,
              declarationId: productPurchase.declarationId,
            },
            select: {
              id: true,
              unitIncomeTax: true,
            },
          });
        } catch (error) {
          console.error("Error retrieving product declaration:", error);
          throw new Error("Internal Server Error");
        }
        //if the product purchase quantity is greater than the remaining sale quantity, create a one sale Detail entry and make the remainig sale quantity 0
        if (productPurchase.remainingQuantity >= remainingSaleQuantity) {
          try {
            sale = await prisma.saleDetail.create({
              data: {
                saleQuantity: remainingSaleQuantity,
                saleUnitPrice: parseFloat(product.saleUnitPrice),
                totalSales:
                  parseFloat(product.saleUnitPrice) * remainingSaleQuantity,
                unitCostOfGoods:
                  (productPurchase.transit.unitTransitCost *
                    remainingSaleQuantity +
                    productPurchase.transport.unitTransportCost *
                      remainingSaleQuantity +
                    productPurchase.esl.unitEslCost * remainingSaleQuantity +
                    remainingSaleQuantity * productDeclaration.unitIncomeTax) /
                    remainingSaleQuantity +
                  parseFloat(productPurchase.purchaseUnitCostOfGoods),
                purchase: { connect: { id: productPurchase.purchaseId } },
                declaration: {
                  connect: { id: productPurchase.declarationId },
                },
                product: { connect: { id: productPurchase.productId } },
                sale: { connect: { id: saleId } },
                productPurchase: { connect: { id: productPurchase.id } },
              },
            });
            inventoryBalance = remainingSaleQuantity;

            provision = await prisma.provision.create({
              data: {
                saleDetail: { connect: { id: sale.id } },
                date: new Date(invoiceDate),
                productDeclaration: { connect: { id: productDeclaration.id } },
              },
            });
          } catch (error) {
            console.error("Error creating sale:", error);
            throw new Error("Internal Server Error");
          }

          //update the productPurchase table
          try {
            await prisma.productPurchase.update({
              where: {
                id: productPurchase.id,
              },
              data: {
                remainingQuantity:
                  productPurchase.remainingQuantity - remainingSaleQuantity,
              },
            });
          } catch (error) {
            console.error("Error updating product purchase:", error);
            throw new Error("Internal Server Error");
          }

          remainingSaleQuantity = 0;
        }
        //if the product purchase quantity is less than the remaining sale quantity, create a sale Detail entry and update the product purchase table
        else if (
          remainingSaleQuantity > productPurchase.remainingQuantity &&
          productPurchase.remainingQuantity !== 0
        ) {
          try {
            const soldQuantity = productPurchase.remainingQuantity;
            sale = await prisma.saleDetail.create({
              data: {
                saleQuantity: soldQuantity,
                saleUnitPrice: parseFloat(product.saleUnitPrice),
                totalSales: product.saleUnitPrice * soldQuantity,
                unitCostOfGoods:
                  (productPurchase.transit.unitTransitCost * soldQuantity +
                    productPurchase.transport.unitTransportCost * soldQuantity +
                    productPurchase.esl.unitEslCost * soldQuantity +
                    soldQuantity * productDeclaration.unitIncomeTax) /
                    soldQuantity +
                  parseFloat(productPurchase.purchaseUnitCostOfGoods),
                purchase: { connect: { id: productPurchase.purchaseId } },
                declaration: {
                  connect: { id: productPurchase.declarationId },
                },
                product: { connect: { id: productPurchase.productId } },
                sale: { connect: { id: saleId } },
                productPurchase: { connect: { id: productPurchase.id } },
              },
            });
            inventoryBalance = soldQuantity;
            provision = await prisma.provision.create({
              data: {
                saleDetail: { connect: { id: sale.id } },
                date: new Date(invoiceDate),
                productDeclaration: { connect: { id: productDeclaration.id } },
              },
            });
          } catch (error) {
            console.error("Error creating sale:", error);
            throw new Error("Internal Server Error");
          }

          //update the productPurchase table
          try {
            await prisma.productPurchase.update({
              where: {
                id: productPurchase.id,
              },
              data: {
                remainingQuantity: 0,
              },
            });
          } catch (error) {
            console.error("Error updating product purchase:", error);
            throw new Error("Internal Server Error");
          }

          remainingSaleQuantity -= productPurchase.remainingQuantity;
        }
        productPurchaseIndex += 1;

        //check if the product has inventory
        let inventoryEntries = [];
        try {
          inventoryEntries = await prisma.inventory.findMany({
            where: {
              productId: product.productId,
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
          throw new Error("Internal Server Error");
        }

        //if the product has no inventory, create a new inventory entry
        let isNewEntry = false;
        if (!inventoryEntries.length) {
          try {
            const inventory = await prisma.inventory.create({
              data: {
                sale: {
                  connect: {
                    id: saleId,
                  },
                },
                saleDetail: {
                  connect: {
                    id: sale.id,
                  },
                },
                product: {
                  connect: {
                    id: product.productId,
                  },
                },
                balanceQuantity: inventoryBalance,
              },
            });
            isNewEntry = true;
            inventoryEntries.push(inventory);
          } catch (error) {
            console.error("Error creating inventory:", error);
            throw new Error("Internal Server Error");
          }
        }

        //get the purchase entry and sale entry
        let purchaseEntry = inventoryEntries.find((entry) => entry.purchaseId);
        let saleEntry = inventoryEntries.find((entry) => entry.saleId);

        //create a new inventory entry
        if (!isNewEntry) {
          try {
            await prisma.inventory.create({
              data: {
                sale: {
                  connect: {
                    id: saleId,
                  },
                },
                saleDetail: {
                  connect: {
                    id: sale.id,
                  },
                },
                product: {
                  connect: {
                    id: product.productId,
                  },
                },
                balanceQuantity: saleEntry
                  ? saleEntry.balanceQuantity - inventoryBalance
                  : purchaseEntry.balanceQuantity - inventoryBalance,
              },
            });
          } catch (error) {
            console.error("Error creating inventory:", error);
            throw new Error("Internal Server Error");
          }
        }

        //create transaction entry for cost of sales
        try {
          await createTransaction(
            costOfSales.id,
            null,
            new Date(invoiceDate),
            null,
            `Invoice`,
            parseFloat(sale.saleQuantity) *
              parseFloat(productPurchase.purchaseUnitPriceETB),
            null,
            null,
            null,
            createdSale.id,
            sale.id,
            null,
            customerId,
            null,
            null
          );

          // create transaction for inventory assets

          await createTransaction(
            inventoryAsset.id,
            null,
            new Date(invoiceDate),
            null,
            `Invoice`,
            null,
            parseFloat(sale.saleQuantity) *
              parseFloat(productPurchase.purchaseUnitPriceETB),
            null,
            null,
            createdSale.id,
            sale.id,
            null,
            customerId,
            null,
            null
          );
        } catch (error) {
          console.error("Error creating transactions:", error);
          throw new Error("Internal Server Error");
        }
        productTotal +=
          parseFloat(sale.saleQuantity) * parseFloat(sale.saleUnitPrice);
      }
      //create transaction for sales of product income
      await createTransaction(
        saleOfProductIncome.id,
        null,
        new Date(invoiceDate),
        null,
        `Invoice`,
        productTotal,
        null,
        null,
        null,
        createdSale.id,
        sale.id,
        null,
        customerId,
        null,
        null
      );
      saleTotalAmount += productTotal;
    }

    //create transaction for accounts receivable
    await createTransaction(
      accountsReceivable.id,
      null,
      new Date(invoiceDate),
      null,
      `Invoice`,
      null,
      saleTotalAmount,
      null,
      null,
      createdSale.id,
      null,
      null,
      customerId,
      null,
      null
    );

    res.json(createdSale);
  } catch (error) {
    console.error("Error creating sale:", error);
    res.status(500).json({ error: error.message });
  }
}

async function getSaleDetails(id) {
  try {
    const saleDetails = await prisma.saleDetail.findMany({
      where: {
        saleId: id,
      },
      select: {
        id: true,
        saleQuantity: true,
        saleUnitPrice: true,
        totalSales: true,
        unitCostOfGoods: true,
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
        purchase: {
          select: {
            id: true,
            number: true,
            date: true,
          },
        },
      },
    });
    return saleDetails;
  } catch (error) {
    console.error("Error retrieving Sale Details:", error);
    return res.status(500).send("Internal Server Error");
  }
}

async function getSaleDetailById(id) {
  try {
    const saleDetail = await prisma.saleDetail.findUnique({
      where: {
        id: id,
      },
      include: {
        product: true,
        declaration: true,
        purchase: true,
      },
    });

    return saleDetail;
  } catch (error) {
    console.error("Error retrieving Sale Detail:", error);
    return res.status(500).send("Internal Server Error");
  }
}

async function getSale(id) {
  try {
    const sale = await prisma.sale.findUnique({
      where: {
        id: id,
      },
      include: {
        customer: true,
      },
    });

    return sale;
  } catch (error) {
    console.error("Error retrieving Sale:", error);
    return res.status(500).send("Internal Server Error");
  }
}

async function getSaleById(req, res) {
  try {
    const { id } = req.params;
    const sale = await getSale(id);
    const saleDetails = await getSaleDetails(id);
    res.json({ ...sale, saleDetails });
  } catch (error) {
    console.error("Error: ", error);
    res.status(500).send(error.message);
  }
}

async function getSalesInvoiceNumber(req, res) {
  try {

    const invoiceNumber = await prisma.sale.findFirst({
      select: {
        invoiceNumber: true
      },
      orderBy: {
        invoiceNumber: 'desc'
      }
    });
    const result = invoiceNumber?.invoiceNumber? ++invoiceNumber.invoiceNumber: 1
     res.json(result);
  }
   catch (error) {
    console.error("Error: ", error);
    res.status(500).send(error.message);
  }
}

async function deleteSaleById(req, res) {
  try {
    const { id } = req.params;

    const saleDetails = await prisma.saleDetail.findMany({
      where: {
        saleId: id,
      },
    });

    if (saleDetails.length === 0) {
      const deletedSale = await deleteCustomerPayment(id);
      res.json(deletedSale);
      return;
    }

    for (const saleDetail of saleDetails) {
      const productPurchase = await prisma.productPurchase.findFirst({
        where: {
          id: saleDetail.productPurchaseId,
        },
      });

      // Calculate the new remaining quantity
      const newRemainingQuantity =
        productPurchase.remainingQuantity + saleDetail.saleQuantity;

      // Update the product purchase with the new remaining quantity
      await prisma.productPurchase.update({
        where: {
          id: productPurchase.id,
        },
        data: {
          remainingQuantity: newRemainingQuantity,
        },
      });
    }

    // After deleting all associated sale details, delete the sale itself
    const deletedSale = await prisma.sale.delete({
      where: {
        id: id,
      },
    });

    res.json(deletedSale);
  } catch (error) {
    console.error("Error deleting Sale:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function updateSale(req, res) {
  try {
    const { id } = req.params; // Extract the sale ID from request parameters
    const { invoiceNumber, invoiceDate, customerId } = req.body; // Extract updated data from request body

    const existingSale = await prisma.sale.findFirst({
      where: {
        invoiceNumber: parseInt(invoiceNumber),
      },
    });

    if (existingSale && existingSale.id !== id) {
      return res
        .status(400)
        .json({ error: "There is already a sale by this invoice number" });
    }

    // Update the Declaration
    const updatedSale = await prisma.sale.update({
      where: { id: id }, // Convert id to integer if needed
      data: {
        invoiceNumber: parseInt(invoiceNumber),
        invoiceDate: new Date(invoiceDate),
        customerId: customerId,
      },
      include: {
        customer: true,
      },
    });

    res.json(updatedSale);
  } catch (error) {
    console.error("Error updating sale:", error);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  getSales,
  createSale,
  getSaleById,
  getSale,
  getSaleDetails,
  getSaleDetailById,
  deleteSaleById,
  updateSale,
  getSalesInvoiceNumber
};
