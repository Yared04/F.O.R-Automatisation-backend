const prisma = require("../../database");

async function getBanks(req, res) {
  try {
    const { page, pageSize } = req.query;

    let banks;
    let totalCount;

    if (page && pageSize) {
      totalCount = await prisma.bank.count();
      banks = await prisma.bank.findMany({
        select: {
          id: true,
          name: true,
          address: true,
          startingValue: true,
          startingValueDate: true,
          bankTransactions: {
            orderBy: { date: "desc" },
          },
        },
        skip: (page - 1) * parseInt(pageSize, 10),
        take: parseInt(pageSize, 10),
        orderBy: { startingValueDate: "desc" },
      });
    } else {
      banks = await prisma.bank.findMany({
        select: {
          id: true,
          name: true,
          address: true,
          startingValue: true,
          startingValueDate: true,
          bankTransactions: {
            orderBy: { date: "desc" },
          },
        },
        orderBy: { startingValueDate: "desc" },
      });

      totalCount = banks.length;
    }

    const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));

    res.json({
      items: banks,
      totalCount: totalCount,
      pageSize: parseInt(pageSize, 10),
      currentPage: parseInt(page, 10),
      totalPages: totalPages,
    });
  } catch (error) {
    console.error("Error getting banks:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function getBankById(req, res) {
  try {
    const bankId = req.params.id;
    const bank = await prisma.bank.findUnique({
      where: { id: bankId },
      select: {
        id: true,
        name: true,
        address: true,
        startingValue: true,
        startingValueDate: true,
      },
    });
    res.json(bank);
  } catch (error) {
    console.error("Error getting bank:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function getBankTransactions(req, res) {
  try {
    const id = req.params.id;
    const { page, pageSize } = req.query;

    let bankTransactions;
    const totalCount = await prisma.bankTransaction.count();

    if (page && pageSize) {
      bankTransactions = await prisma.bankTransaction.findMany({
        where: {
          bankId: id,
        },
        include: {
          chartofAccount: true,
        },
        skip: (page - 1) * parseInt(pageSize, 10),
        take: parseInt(pageSize, 10),
        orderBy: { date: "desc" },
      });
    } else {
      bankTransactions = await prisma.bankTransaction.findMany({
        where: {
          bankId: id,
        },
        include: {
          chartofAccount: true,
        },
        orderBy: { date: "desc" },
      });
    }

    const totalPages = Math.ceil(totalCount / parseInt(pageSize, 10));

    res.json({
      items: bankTransactions,
      totalCount: totalCount,
      pageSize: parseInt(pageSize, 10),
      currentPage: parseInt(page, 10),
      totalPages: totalPages,
    });
  } catch (error) {
    console.error("Error getting banks:", error);
    res.status(500).send("Internal Server Error");
  }
}
async function createBank(req, res) {
  const { name, address, startingValue, startingValueDate } = req.body;
  try {
    const createdBank = await prisma.bank.create({
      data: {
        name: name,
        address: address,
        startingValue: parseFloat(startingValue),
        startingValueDate: new Date(startingValueDate),
      },
    });

    const createdBankTransaction = await prisma.bankTransaction.create({
      data: {
        bank: {
          connect: {
            id: createdBank.id,
          },
        },
        date: new Date(startingValueDate), // Starting date
        balance: parseFloat(startingValue), // Starting value
      },
    });

    const accountType = await prisma.accountType.findFirst({
      where: {
        name: "Bank",
      },
    });

    const accountSubType = await prisma.accountSubType.findFirst({
      where: {
        name: "Current",
      },
    });

    const createdChartOfAccount = await prisma.chartOfAccount.create({
      data: {
        name: name,
        accountTypeId: accountType.id,
        accountSubTypeId: accountSubType.id,
      },
      include: {
        accountType: true,
        accountSubType: true,
      },
    });

    res.json(createdBank);
  } catch (error) {
    console.error("Error creating bank:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function updateBank(req, res) {
  try {
    const bankId = req.params.id;
    const { name, address, startingValue, startingValueDate } = req.body;

    const beforeUpdate = await prisma.bank.findUnique({
      where: {
        id: bankId,
      },
    });
    const updatedBank = await prisma.bank.update({
      where: { id: bankId },
      data: {
        name: name,
        address: address,
        startingValue: parseFloat(startingValue),
        startingValueDate: new Date(startingValueDate),
      },
    });

    const updatedBankTransaction = await prisma.bankTransaction.updateMany({
      where: {
        bankId: bankId,
        AND: [
          { payee: null },
          { payment: null },
          { deposit: null },
          { type: null },
          { chartofAccountId: null },
          { exchangeRate: null },
        ],
      },
      data: {
        balance: parseFloat(startingValue), // Starting value
        date: startingValueDate,
      },
    });

    const updatedChartOfAccount = await prisma.chartOfAccount.updateMany({
      where: {
        name: beforeUpdate.name,
      },
      data: {
        name: name,
      },
    });

    res.json(updatedBank);
  } catch (error) {
    console.error("Error updating bank:", error);
    res.status(500).send("Internal Server Error");
  }
}

async function deleteBank(req, res) {
  try {
    const bankId = req.params.id;

    const deletedBank = await prisma.bank.delete({
      where: { id: bankId },
    });

    const deletedChartOfAccount = await prisma.chartOfAccount.deleteMany({
      where: {
        name: deletedBank.name,
      },
    });

    res.json(deletedBank);
  } catch (error) {
    console.error("Error deleting bank:", error);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = {
  getBanks,
  createBank,
  updateBank,
  deleteBank,
  getBankById,
  getBankTransactions,
};
