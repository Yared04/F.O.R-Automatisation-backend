const prisma = require("../../database");
const PDFDocument = require("pdfkit");
const { Readable } = require("stream");

async function generateBalanceSheetReport(req, res) {
  try {
    const { endDate } = req.query; // Get start and end dates from query parameters
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
      "Other Expenses",
    ];

    const incomeAccountTypes = ["Income", "Other Income"];

    if (endDate) {
      CaFilter.date = {
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

    const tr = aggregateTransactions(transactions);

    // Generate PDF content
    const pdfContent = await generateBalanceSheetPdf(
      tr,
      endDate
    );

    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="balancesheet.pdf"'
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

function aggregateTransactions(transactions) {
  /*
  "Other Current Assets"
"Other Current Liabilities"
"Expenses"
"Cost of Goods Sold"
"Income"
"Equity"
"Other Expenses"
"Other Income"
"Other Assets"
"Accounts Receivable(A/R)"
"Accounts Payable(A/P)"
  */

  const aggregateTransactions = {
    accountReceivable: {},
    currentAsset: {},
    accountPayable: {},
    provisions: {},
    shareHoldersEquity:{},
    netEarning: 0,
    totalAccountsReceivable: 0,
    totalCurrentAssets: 0,
    totalAccountsPayable:0,
    totalCurrentLiabilities: 0,
    totalAssets: 0,
    totalShareHoldersEquity: 0,
    totalLiabilitiesAndEquity: 0,
  };
  transactions.forEach((transaction) => {
    const { debit, credit, chartofAccount } = transaction;
    const accountType = chartofAccount?.accountType?.name;

    if (accountType === "Accounts Receivable(A/R)") {
      if (aggregateTransactions.accountReceivable[chartofAccount.name]) {
        aggregateTransactions.accountReceivable[chartofAccount.name].value += credit ?? 0;
      } else {
        aggregateTransactions.accountReceivable[chartofAccount.name] = {
          value: credit ?? 0,
        };
      }
      aggregateTransactions.totalAccountsReceivable += credit;
    }
    else if (accountType === "Other Current Assets") {
      if (aggregateTransactions.currentAsset[chartofAccount.name]) {
        aggregateTransactions.currentAsset[chartofAccount.name].value += credit ?? 0;
      } else {
        aggregateTransactions.currentAsset[chartofAccount.name] = {
          value: credit ?? 0,
        };
      }
      aggregateTransactions.totalCurrentAssets += credit;
    } else if (accountType === "Accounts Payable(A/P)") {
      if (aggregateTransactions.accountPayable[chartofAccount.name]) {
        aggregateTransactions.accountPayable[chartofAccount.name].value += debit ?? 0;
      } else {
        aggregateTransactions.accountPayable[chartofAccount.name] = {
          value: debit ?? 0,
        };
      }
      aggregateTransactions.totalAccountsPayable += debit;
    } else if (accountType === "Other Assets") {
      if (aggregateTransactions.provisions[chartofAccount.name]) {
        aggregateTransactions.provisions[chartofAccount.name].value += credit ?? 0;
      } else {
        aggregateTransactions.provisions[chartofAccount.name] = {
          value: credit ?? 0,
        };
      }
      aggregateTransactions.totalCurrentLiabilities += credit;
    }  
    else if (accountType === "Equity") {
      if (aggregateTransactions.shareHoldersEquity[chartofAccount?.name]) {
        aggregateTransactions.shareHoldersEquity[chartofAccount?.name].value +=
          debit ?? credit;
      } else {
        aggregateTransactions.shareHoldersEquity[chartofAccount.name] = {
          value: debit ?? credit,
        };
      }
      aggregateTransactions.totalShareHoldersEquity += debit??credit;

    } else {
      // incase of new transactions debits are included with other assets and credits are included other liabilities with provisions
      if (debit) {
        if (aggregateTransactions.currentAsset[chartofAccount?.name]) {
          aggregateTransactions.currentAsset[chartofAccount?.name].value +=
            debit ?? 0;
        } else {
          aggregateTransactions.currentAsset[chartofAccount?.name] = {
            value: debit ?? credit,
          };
        }
        aggregateTransactions.totalCurrentAssets += debit;
      } else if( credit) {
        if (aggregateTransactions.provisions[chartofAccount?.name]) {
          aggregateTransactions.provisions[chartofAccount?.name].value +=
            credit ?? 0;
        } else {
          aggregateTransactions.provisions[chartofAccount?.name] = {
            value: credit ?? 0,
          };
        }
        aggregateTransactions.totalCurrentLiabilities += credit;
      }
    }
  });
  aggregateTransactions.netEarning = calculateNetIncome(transactions);
  aggregateTransactions.totalAssets =
    aggregateTransactions.totalAccountsReceivable + aggregateTransactions.totalCurrentAssets;
  aggregateTransactions.totalLiabilitiesAndEquity =
    aggregateTransactions.totalAccountsPayable +
    aggregateTransactions.totalCurrentLiabilities +
      aggregateTransactions.totalShareHoldersEquity;
      aggregateTransactions.totalCurrentLiabilities = aggregateTransactions.totalAccountsPayable - aggregateTransactions.totalCurrentLiabilities;

    

  return aggregateTransactions;
}

function calculateNetIncome(transactions) {
  const expenseAccountTypes = ["Expenses", "Other Expenses"];

  const incomeAccountTypes = ["Income", "Other Income"];
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
    const { debit, credit, chartofAccount } = transaction;
    const accountType = chartofAccount?.accountType?.name;

    if (incomeAccountTypes.includes(accountType)) {
      if (aggregateTransactions.income[chartofAccount.name]) {
        aggregateTransactions.income[chartofAccount.name].value += credit ?? 0;
      } else {
        aggregateTransactions.income[chartofAccount.name] = {
          value: credit ?? 0,
          name: chartofAccount,
        };
      }
      aggregateTransactions.incomeTotal += credit;
    } else if (expenseAccountTypes.includes(accountType)) {
      if (aggregateTransactions.expenses[chartofAccount.name]) {
        aggregateTransactions.expenses[chartofAccount.name].value += debit ?? 0;
      } else {
        aggregateTransactions.expenses[chartofAccount.name] = {
          value: debit ?? 0,
          name: chartofAccount.name,
        };
      }
      aggregateTransactions.expensesTotal += debit;
    } else if (accountType === "Other Expenses") {
      if (!aggregateTransactions.otherExpenses[chartofAccount.name]) {
        aggregateTransactions.otherExpenses[chartofAccount.name].value +=
          debit ?? 0;
      } else {
        aggregateTransactions.otherExpenses[chartofAccount.name] = {
          value: debit ?? 0,
          name: chartofAccount.name,
        };
      }
      aggregateTransactions.otherExpenses[chartofAccount.name].name =
        chartofAccount;
      aggregateTransactions.otherExpensesTotal += debit;
    } else if (accountType === "Cost of Goods Sold") {
      if (aggregateTransactions.costOfSales[chartofAccount.name]) {
        aggregateTransactions.costOfSales[chartofAccount.name].value +=
          debit ?? 0;
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
    aggregateTransactions.incomeTotal - aggregateTransactions.expensesTotal;
  aggregateTransactions.netEarning =
    aggregateTransactions.grossProfit -
    (aggregateTransactions.expensesTotal +
      aggregateTransactions.otherExpensesTotal);

  return aggregateTransactions.netEarning;
}

async function generateBalanceSheetPdf(transactions, endDate) {
  const handleTimeSpan = () => {
    if (endDate) {
      return `As of ${formatDateUTCtoMMDDYYYY(
        new Date(endDate)
      )}`;
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

    const columnTitles = [" ", "Total"];
    const columnOffsets = [10, 390];


    let pageCount = 1;

    const addHeaders = () => {
      ++pageCount;
      if (pageCount >= 1) {
        doc.addPage();
      }
      xOffset = 10;
      yOffset = 190;
      doc
        .fontSize(10)
        .text("Balance sheet", { align: "center" })
        .moveDown();
      doc.fontSize(8).text(handleTimeSpan(), { align: "center" }).moveDown();
      doc.fontSize(5);
      columnTitles.forEach((title) => {
        doc.text(title[0], xOffset, 150);
        xOffset += 390;
      });
      doc.lineWidth(0.5); // Set line weight to 2 (adjust as needed)
      doc.moveTo(10, 145).lineTo(600, 145).stroke(); // Line above the first row
      doc.moveTo(10, 165).lineTo(600, 165).stroke(); // Line above the first row
      xOffset = 10;
      doc.fontSize(10);
    };

    const addSpacing = (val)=>{
      if(yOffset + val > 680){
        addHeaders();
      }
      else{
        yOffset += val;
      }
    }

    // add table headers
    doc.moveTo(0, 50);
    doc.fontSize(10).text("BalanceSheet", { align: "center" }).moveDown();
    doc.fontSize(8).text(handleTimeSpan(), { align: "center" }).moveDown();

    doc.moveTo(10, 105).lineTo(600, 105).stroke(); // Line above the first row

    doc.moveTo(10, 120).lineTo(600, 120).stroke(); // Line above the first row

    columnTitles.forEach((title, i) => {
      doc.text(title, columnOffsets[i], 110);
    });

    doc.lineWidth(0.5); // Set line weight to 0.5 (adjust as needed)
    doc.moveTo(10, 120).lineTo(600, 120).stroke(); // Line above the first row

    let yOffset = 130;
    doc.fontSize(10).text("Assets", 10, yOffset).moveDown();
    addSpacing(15);
    doc.fontSize(10).text("current Assets", 15, yOffset).moveDown();
    addSpacing(15);
    doc.fontSize(10).text("Accounts receivable", 20, yOffset).moveDown();
    addSpacing(15);
    // account receivable
    if (Object.keys(transactions.accountReceivable).length !== 0) {
      Object.entries(transactions.accountReceivable).forEach((transaction) => {
        doc.text(transaction[0], columnOffsets[0], yOffset);
        doc.text(transaction[1].value?.toFixed(2), columnOffsets[1], yOffset);
        addSpacing(15);
      });
    }
    doc.lineWidth(0.2);
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();
    doc.lineWidth(0.5);
    addSpacing(10);
    doc.text("Total account receivable", columnOffsets[0], yOffset);
    doc.text(transactions.incomeTotal?.toFixed(2), columnOffsets[1], yOffset);

    addSpacing(20);

    // current assets
    if (Object.keys(transactions.currentAsset).length !== 0) {
      Object.entries(transactions.currentAsset).forEach((transaction) => {
        doc.text(transaction[0], columnOffsets[0], yOffset);
        doc.text(transaction[1].value?.toFixed(2), columnOffsets[1], yOffset);
        addSpacing(15);
      });
    }
    doc.lineWidth(0.2)
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();
    doc.lineWidth(0.5)
    addSpacing(10);
    doc.text("Total current asset", columnOffsets[0], yOffset);
    doc.text(transactions.totalCurrentAssets?.toFixed(2), columnOffsets[1], yOffset);
    addSpacing(20);
    doc.lineWidth(0.2)
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();
    doc.lineWidth(0.5)
    addSpacing(10);
    doc.text("Total asset", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.totalAssets?.toFixed(2)}`, columnOffsets[1], yOffset);
    addSpacing(10);

    doc.lineWidth(0.6)
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();
    addSpacing(2);
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();
    addSpacing(10);
    doc.lineWidth(0.5)

    // expenses
    doc.fontSize(10).text("liabilities and share holder's equity", 10, yOffset).moveDown();
    addSpacing(15);
    doc.fontSize(10).text("current liabilities:", 15, yOffset).moveDown();
    addSpacing(15);
    doc.fontSize(10).text("Accounts payable", 20, yOffset).moveDown();
    addSpacing(15);
    if (Object.keys(transactions.accountPayable).length !== 0) {
      Object.entries(transactions.accountPayable).forEach((transaction) => {
        doc.text(transaction[0], columnOffsets[0], yOffset);
        doc.text(transaction[1].value?.toFixed(2), columnOffsets[1], yOffset);
        addSpacing(15);
      });
    }
    doc.lineWidth(0.2);
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();
    doc.lineWidth(0.5)
    addSpacing(10);
    doc.text("Total Account payable", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.totalAccountsPayable?.toFixed(2)}`, columnOffsets[1], yOffset);
    addSpacing(20);

    // provisions
    Object.entries(transactions.provisions).forEach((transaction) => {
      doc.text(transaction[0], columnOffsets[0], yOffset);
      doc.text(transaction[1].value?.toFixed(2), columnOffsets[1], yOffset);
      addSpacing(15);
    });
    doc.fontSize(10);
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();
    addSpacing(10);
    doc.text("Total current liabilities", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.totalCurrentLiabilities?.toFixed(2)}`, columnOffsets[1], yOffset);
    addSpacing(20);


    // share holders' equity
    doc.text("Shareholders' equity", columnOffsets[0], yOffset);
    addSpacing(20);
    doc.text("net income", columnOffsets[0], yOffset);
    doc.text(transactions.netEarning?.toFixed(2), columnOffsets[1], yOffset);
    addSpacing(15);
    Object.entries(transactions.shareHoldersEquity).forEach((transaction) => {
      doc.text(transaction[0], columnOffsets[0], yOffset);
      doc.text(transaction[1].value?.toFixed(2), columnOffsets[1], yOffset);
      addSpacing(15);
    });
    doc.lineWidth(0.2)
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();
    doc.lineWidth(0.5);
    addSpacing(10);
    doc.text("Total shareholders' equity", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.totalShareHoldersEquity?.toFixed(2)}`, columnOffsets[1], yOffset);
    addSpacing(10);

    doc.lineWidth(0.2)
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();
    doc.lineWidth(0.5);
    addSpacing(10);
    doc.text("Total liabilities and equity", columnOffsets[0], yOffset);
    doc.text(`Br ${transactions.totalLiabilitiesAndEquity?.toFixed(2)}`, columnOffsets[1], yOffset);
    addSpacing(10);
    doc.lineWidth(0.6);
    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke();

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
  generateBalanceSheetReport,
};
