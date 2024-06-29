const prisma = require("../../database");
const PDFDocument = require("pdfkit");
const { Readable } = require("stream");

async function generateProfitAndLossReport(req, res) {
  try {
    const { startDate, endDate } = req.query; // Get start and end dates from query parameters
    let CaFilter = {
      OR: [
        {
          bankTransactionId: {
            not: null,
          },
        },
        {
          chartofAccountId: {
            not: null,
          },
        },
      ],
    };

    const expenseAccountTypes = [
      "Expenses",
      "Cost of Goods Sold",
    ];

    const incomeAccountTypes = ["Sales of Product Income"];

    if (startDate && endDate) {
      CaFilter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }
    // Find the Chart of Account for Accounts Receivable (A/R)
    const transactions = await prisma.CATransaction.findMany({
      where: CaFilter,
      include: {
        saleDetail: {
          select: {
            unitCostOfGoods: true,
            saleQuantity: true,
          },
        },
        chartofAccount: {
          select: {
            name: true,
            accountType: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    const aggregateTransactions = aggregatedTransactions(transactions);


    // Generate PDF content
    const pdfContent = await generateProfitLossPdf(
      aggregateTransactions,
      startDate,
      endDate
    );

    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="profit-and-loss.pdf"'
    );

    // Stream PDF content to the client
    const stream = new Readable();
    stream.push(pdfContent);
    stream.push(null); // Indicates the end of the stream
    stream.pipe(res);
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
}

function aggregatedTransactions(transactions) {
  const expenseAccountTypes = ["Expenses"];

  const incomeAccountTypes = ["Income","Sales of Product Income"];
  const aggregateTransactions = {
    income: {},
    costOfSales: {},
    expenses: {},
    otherExpenses: {},
    netEarning: 0,
    grossProfit: 0,
    incomeTotal: 0,
    costOfSalesTotal: 0,
    expensesTotal: 0,
    otherExpensesTotal: 0,
  };
  transactions.forEach((transaction) => {
    const { debit, credit, chartofAccount, supplierId } = transaction;
    const accountType = chartofAccount?.accountType?.name;
    
    if (incomeAccountTypes.includes(accountType)) {
      if (aggregateTransactions.income[chartofAccount.name]) {
        aggregateTransactions.income[chartofAccount.name].value += debit ?? 0;
      } else {
        aggregateTransactions.income[chartofAccount.name] = {
          value: debit ?? 0,
          name: chartofAccount,
        };
      }
      aggregateTransactions.incomeTotal += debit;
    } else if (expenseAccountTypes.includes(accountType)) {
      if (aggregateTransactions.expenses[chartofAccount.name]) {
        if(supplierId)
        aggregateTransactions.expenses[chartofAccount.name].value += debit ?? 0;
      } else {
        aggregateTransactions.expenses[chartofAccount.name] = {
          value: debit ?? 0,
          name: chartofAccount.name,
        };
      }
      aggregateTransactions.expensesTotal += debit;
    }  else if (accountType === "Cost of Goods Sold") {
      if (aggregateTransactions.costOfSales[chartofAccount.name]) {
        aggregateTransactions.costOfSales[chartofAccount.name].value += debit ?? 0;
      } else {
        aggregateTransactions.costOfSales[chartofAccount.name] = {
          value: debit ?? 0,
          name: chartofAccount.name,
        };
      }
      aggregateTransactions.costOfSalesTotal += debit;
    }
  });
  aggregateTransactions.grossProfit =
    aggregateTransactions.incomeTotal -
    aggregateTransactions.costOfSalesTotal;
  aggregateTransactions.netEarning =
    aggregateTransactions.grossProfit -
    (aggregateTransactions.expensesTotal +
      aggregateTransactions.otherExpensesTotal);

  return aggregateTransactions;
}

async function generateProfitLossPdf(
  transactions,
  startDate,
  endDate
) {
  const handleTimeSpan = () => {
    if (startDate && endDate) {
      return `Transactions from ${formatDateUTCtoMMDDYYYY(
        new Date(startDate)
      )} to ${formatDateUTCtoMMDDYYYY(new Date(endDate))}`;
    }
    return "All Dates";
  };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];

    // Buffer PDF content
    doc.on("data", (buffer) => buffers.push(buffer));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // add table headers
    doc.moveTo(0, 50);
    doc.fontSize(10).text("Profit and loss", { align: "center" }).moveDown();
    doc.fontSize(8).text(handleTimeSpan(), { align: "center" }).moveDown();

    const columnTitles = [" ", "Total"];
    const columnOffsets = [10, 390];

    columnTitles.forEach((title, i) => {
      doc.text(title, columnOffsets[i], 110);
    });

    doc.lineWidth(0.5); // Set line weight to 0.5 (adjust as needed)
    doc.moveTo(10, 120).lineTo(600, 120).stroke(); // Line above the first row

    let yOffset = 130;
    doc.fontSize(10).text("Income", 10, yOffset).moveDown();
    yOffset +=20;

    // incomes
    if (Object.keys(transactions.income).length !== 0) {
      Object.entries(transactions.income).forEach((transaction) => {
        doc.text(transaction[0], columnOffsets[0], yOffset);
      doc.text(transaction[1].value?.toFixed(2), columnOffsets[1], yOffset);
        yOffset += 20;
      });
    }
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke(); 
    yOffset += 10;
    doc.text("Total Income", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.incomeTotal?.toFixed(2)}`, columnOffsets[1], yOffset);

    yOffset+=20;

    doc.text("Cost of Sales", columnOffsets[0], yOffset);
    yOffset += 20;
    // cost of sales
    if (Object.keys(transactions.costOfSales).length !== 0) {
      Object.entries(transactions.costOfSales).forEach((transaction) => {
        doc.text(transaction[0], columnOffsets[0], yOffset);
        doc.text(transaction[1].value?.toFixed(2), columnOffsets[1], yOffset);
      yOffset += 20;
      });
    }
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke(); 
    yOffset += 10;
    doc.text("Total cost of sales", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.costOfSalesTotal?.toFixed(2)}`, columnOffsets[1], yOffset);
    yOffset+=20;
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke(); 
    yOffset += 10;
    doc.text("GROSS PROFIT", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.grossProfit?.toFixed(2)}`, columnOffsets[1], yOffset);
    yOffset+=20;
    // expenses
    doc.fontSize(10).text("Expenses", 10, yOffset).moveDown();
    yOffset += 20;
    if (Object.keys(transactions.expenses).length !== 0) {
      Object.entries(transactions.expenses).forEach((transaction) => {
      doc.text(transaction[0], columnOffsets[0], yOffset);
      doc.text(transaction[1].value?.toFixed(2), columnOffsets[1], yOffset);
      yOffset += 20;
      });
    }
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke(); 
    yOffset += 10;
    doc.text("Total Expenses", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.expensesTotal?.toFixed(2)}`, columnOffsets[1], yOffset);
    yOffset += 20;

    // other expenses
    doc.fontSize(10).text("Other Expenses", 10, yOffset).moveDown();
    yOffset += 20;
    Object.entries(transactions.otherExpenses).forEach((transaction) => {
      doc.text(transaction[0], columnOffsets[0], yOffset);
      doc.text(transaction[1].value?.toFixed(2), columnOffsets[1], yOffset);
      yOffset += 20;
    });
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke(); 
    yOffset += 10;
    doc.text("Total Other Expenses", columnOffsets[0], yOffset);
doc.text(`Br ${transactions.otherExpensesTotal?.toFixed(2)}`, columnOffsets[1], yOffset);
    yOffset += 20;

    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke(); 
    yOffset +=10;
    doc.text("NET EARINING", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.netEarning?.toFixed(2)}`, columnOffsets[1], yOffset);
    doc.end();
  });
}

function formatDateUTCtoMMDDYYYY(utcDate) {
  const date = new Date(utcDate);
  const mm = date.getUTCMonth() + 1; // getMonth() is zero-based
  const dd = date.getUTCDate();
  const yyyy = date.getUTCFullYear();

  return `${mm.toString().padStart(2, "0")}/${dd
    .toString()
    .padStart(2, "0")}/${yyyy}`;
}

module.exports = {
  generateProfitAndLossReport,
};
