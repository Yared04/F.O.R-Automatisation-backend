const { parse } = require("path");
const prisma = require("../../database");

async function getCaTransactions(req, res) {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const totalCount = await prisma.CATransaction.count();
    const caTransactions = await prisma.CATransaction.findMany({
      orderBy: {
        createdAt: "desc",
      },
      include: {
        supplier: {
          select: {
            name: true,
          },
        },
        customer: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        productPurchase: {
          select: {
            product: true,
          }
        },
        saleDetail: true,
        bankTransaction: {
          select: {
            bank: {
              select: {
                name: true,
              },
            },
          },
        },
        purchase: {
          select: {
            number: true,
          },
        },
        sale: {
          select: {
            invoiceNumber: true,
          },
        },
        chartofAccount: {
          select: {
            name: true,
          },
        },
      },
      skip: (page - 1) * parseInt(pageSize, 10),
      take: parseInt(pageSize, 10),
    });
    // let caTransactionsList = [];
    // caTransactionsList = await Promise.all(
    //   caTransactions.map(async (caTransaction) => {
    //     const {
    //       createdAt,
    //       updatedAt,
    //       purchaseId,
    //       saleId,
    //       chartofAccountId,
    //       ...updatedCaTransaction
    //     } = caTransaction;
    //     let updatedCATransaction = updatedCaTransaction;

    //     const chartofAccount = caTransaction.chartofAccountId
    //       ? await prisma.chartOfAccount.findUnique({
    //           where: { id: caTransaction.chartofAccountId },
    //         })
    //       : await prisma.bank.findUnique({
    //           where: { id: caTransaction.bankId },
    //         });
    //     updatedCATransaction.chartofAccount = chartofAccount.name;

    //     if (caTransaction.purchaseId) {
    //       let declarationNumbers = [];
    //       let purchaseNumber;
    //       const currentPurchase = await prisma.purchase.findUnique({
    //         where: { id: caTransaction.purchaseId },
    //       });
    //       const currentProductPurchases = await prisma.productPurchase.findMany(
    //         {
    //           where: { purchaseId: caTransaction.purchaseId },
    //           include: { declaration: true },
    //         }
    //       );
    //       if (currentProductPurchases) {
    //         purchaseNumber = currentPurchase.number;
    //         declarationNumbers = [
    //           ...new Set(
    //             currentProductPurchases.map(
    //               (productPurchase) => productPurchase.declaration.number
    //             )
    //           ),
    //         ];
    //         updatedCATransaction = {
    //           ...updatedCATransaction,
    //           purchaseNumber,
    //           declarationNumbers,
    //         };
    //       }
    //     }

    //     if (caTransaction.saleId) {
    //       let saleNum;
    //       const sale = await prisma.sale.findUnique({
    //         where: { id: caTransaction.saleId },
    //       });
    //       if (sale) {
    //         saleNum = sale.invoiceNumber;
    //         updatedCATransaction = {
    //           ...updatedCATransaction,
    //           invoiceNumber: saleNum,
    //         };
    //       }
    //     }

    //     return updatedCATransaction;
    //   })
    // );

    const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));
    res.json({
      items: caTransactions,
      totalCount: totalCount,
      pageSize: parseInt(pageSize, 10),
      currentPage: parseInt(page, 10),
      totalPages: totalPages,
    });
  } catch (error) {
    console.error("Error retrieving CA Transactions:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function createBankTransaction(req, res) {
  const {
    bankId,
    payee,
    foreignCurrency,
    payment,
    deposit,
    type,
    chartofAccountId,
    exchangeRate,
  } = req.body;
  try {
    const bankTransactions = await prisma.bankTransaction.findMany({
      where: { bankId: bankId },
      orderBy: { createdAt: "desc" },
    });

    const supplier = payee
      ? await prisma.supplier.findUnique({
          where: { id: payee },
        })
      : null;
    const createdBankTransaction = await prisma.bankTransaction.create({
      data: {
        bank: {
          connect: {
            id: bankId,
          },
        },
        payee: supplier ? supplier.name : null,
        foreignCurrency: parseFloat(foreignCurrency),
        balance: bankTransactions[0]
          ? parseFloat(Number(bankTransactions[0].balance)) -
            parseFloat(Number(payment)) +
            parseFloat(Number(deposit))
          : parseFloat(Number(deposit)) - parseFloat(Number(payment)),
        payment: parseFloat(payment),
        deposit: parseFloat(deposit),
        type: type,
        chartofAccount: {
          connect: {
            id: chartofAccountId,
          },
        },
        exchangeRate: exchangeRate,
      },
    });

    res.json(createdBankTransaction);
  } catch (error) {
    console.error("Error creating bank transaction:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function createSupplierPayment(req, res) {
  try {
    const {
      supplierId,
      date,
      exchangeRate,
      number,
      paidAmountETB,
      paidAmountUSD,
    } = req.body;
    const purchaseNumber = await prisma.purchase.findUnique({
      where: { id: number },
    });
    const createdSupplierPayment = await prisma.purchase.create({
      data: {
        supplier: {
          connect: {
            id: supplierId,
          },
        },
        date: new Date(date),
        number: purchaseNumber.number,
        exchangeRate: exchangeRate,
        paidAmountUSD: exchangeRate ? paidAmountUSD : null,
        paidAmountETB: exchangeRate
          ? exchangeRate * paidAmountETB
          : paidAmountUSD,
      },
    });
    res.json(createdSupplierPayment);
  } catch (error) {
    console.error("Error creating supplier payment:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function createCustomerPayment(req, res) {
  const { date, paidAmount, saleId, customerId } = req.body;
  try {
    const invoiceNumber = await prisma.sale.findUnique({
      where: { id: saleId },
    });

    const createdCustomerPayment = await prisma.sale.create({
      data: {
        invoiceDate: new Date(date),
        paidAmount: parseFloat(paidAmount),
        customer: {
          connect: {
            id: customerId,
          },
        },
        invoiceNumber: invoiceNumber.invoiceNumber,
      },
    });
    res.json(createdCustomerPayment);
  } catch (error) {
    console.error("Error creating customer payment:", error);
    res.status(500).send("Internal Server Error");
  }
}



async function createTransaction(
  chartofAccountId,
  bankId,
  date,
  remark,
  type,
  debit,
  credit,
  purchaseId,
  productPurchaseId,
  saleId,
  saleDetailId,
  supplierId,
  customerId,
  exchangeRate,
  USDAmount
) {
  try {
    let createdCaTransaction;
    const bankTransactions =
      bankId &&
      (await prisma.bankTransaction.findMany({
        where: { bankId: bankId },
        orderBy: { createdAt: "desc" },
      }));
    createdCaTransaction = await prisma.CATransaction.create({
      data: {
        chartofAccount: chartofAccountId
          ? {
              connect: { id: chartofAccountId },
            }
          : undefined,
        bankTransaction:
          bankTransactions && bankTransactions[0]
            ? { connect: { id: bankTransactions[0].id } }
            : undefined,
        sale: saleId
          ? {
              connect: { id: saleId },
            }
          : undefined,
        purchase: purchaseId
          ? {
              connect: {
                id: purchaseId,
              },
            }
          : undefined,
        productPurchase: productPurchaseId
          ? {
              connect: {
                id: productPurchaseId,
              },
            }
          : undefined,
        saleDetail: saleDetailId
          ? {
              connect: {
                id: saleDetailId,
              },
            }
          : undefined,
        supplier: supplierId
          ? {
              connect: {
                id: supplierId,
              },
            }
          : undefined,
        customer: customerId
          ? {
              connect: {
                id: customerId,
              },
            }
          : undefined,
        exchangeRate: exchangeRate,
        USDAmount: USDAmount,
        type: type,
        date: new Date(date),
        remark: remark,
        debit: parseFloat(debit),
        credit: parseFloat(credit),
      },
    });

    return createdCaTransaction;
  } catch (error) {
    console.error("Error creating CA Transaction:", error);
    return error, "Internal Server Error";
  }
}

async function createCaTransaction(req, res) {
  try {
    const {
      chartofAccountId,
      bankId,
      date,
      remark,
      type,
      debit,
      credit,
      purchaseId,
      productPurchaseId,
      saleId,
      saleDetailId,
      supplierId,
      customerId,
      exchangeRate,
      USDAmount,
    } = req.body;
    const transaction = await createTransaction(
      chartofAccountId,
      bankId,
      date,
      remark,
      type,
      debit,
      credit,
      purchaseId,
      productPurchaseId,
      saleId,
      saleDetailId,
      supplierId,
      customerId,
      exchangeRate,
      USDAmount
    );

    res.json(transaction);
  } catch (error) {
    console.error("Error creating CA Transaction:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function getCaTransactionById(req, res) {
  try {
    const caTransactionId = req.params.id;
    const caTransaction = await prisma.CATransaction.findUnique({
      where: { id: caTransactionId },
    });
    if (!caTransaction) {
      return res.status(404).send("CA Transaction not found");
    }
    const {
      createdAt,
      updatedAt,
      purchaseId,
      saleId,
      chartofAccountId,
      ...updatedCaTransaction
    } = caTransaction;
    let updatedCATransaction = updatedCaTransaction;

    const chartofAccount = await prisma.chartOfAccount.findUnique({
      where: { id: caTransaction.chartofAccountId },
    });
    updatedCATransaction.chartofAccount = chartofAccount.name;

    if (caTransaction.purchaseId) {
      let declarationNumbers = [];
      let purchaseNumber;
      const currentPurchase = await prisma.purchase.findUnique({
        where: { id: caTransaction.purchaseId },
      });
      const currentProductPurchases = await prisma.productPurchase.findMany({
        where: { purchaseId: caTransaction.purchaseId },
        include: { declaration: true },
      });
      if (currentProductPurchases) {
        purchaseNumber = currentPurchase.number;
        declarationNumbers = [
          currentProductPurchases.map(
            (productPurchase) => productPurchase.declaration.number
          ),
        ];
        updatedCATransaction = {
          ...updatedCATransaction,
          purchaseNumber,
          declarationNumbers,
        };
      }
    }

    if (caTransaction.saleId) {
      let saleNum;
      const sale = await prisma.sale.findUnique({
        where: { id: caTransaction.saleId },
      });
      if (sale) {
        saleNum = sale.invoiceNumber;
        updatedCATransaction = {
          ...updatedCATransaction,
          invoiceNumber: saleNum,
        };
      }
    }

    res.json(updatedCATransaction);
  } catch (error) {
    console.error("Error retrieving CA Transaction:", error);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  getCaTransactions,
  createCaTransaction,
  getCaTransactionById,
  createTransaction,
  createSupplierPayment,
  createBankTransaction,
  createCustomerPayment,
};
