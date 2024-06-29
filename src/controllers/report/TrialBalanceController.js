const prisma = require("../../database");
const PDFDocument = require("pdfkit");
const { Readable } = require("stream");

async function generateTrialBalance(req, res) {
  try {
    const { startDate, endDate } = req.query; // Get start and end dates from query parameters
    let CaFilter =  {
    OR:[
      { bankTransactionId: {
        not: null
      }},
      { chartofAccountId:{
        not:null
      }}
    ]
    }  
    
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
            saleQuantity: true,
            totalSales: true,
          },
        },
        chartofAccount: {
          select: {
            name: true,
          },
        },
        bankTransaction: {
          select: {
            bank: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });
    // return accountType credit and debit detail
    const aggregatedTransactions = aggregateTransactions(transactions);

    //return total credit and debit
    const totals = calculateCreditDebitTotal(aggregatedTransactions);

    // Generate PDF content
    const pdfContent = await generateTrialBalancePdf(
      aggregatedTransactions,
      totals,startDate,endDate
    );

    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="TrialBalance.pdf"'
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
  const aggregatedTransactions = {};
  transactions.forEach((transaction) => {
    const {debit, credit, chartofAccount, bankTransaction, saleDetail} = transaction;
    const accountName = chartofAccount?.name;
    const bankName = bankTransaction?.bank?.name??"";
    const accountType = accountName || bankName;
    

    if (!aggregatedTransactions[accountType]) {
      aggregatedTransactions[accountType] = {
        credit: 0,
        debit: 0,
      };
    }

    if (credit) {
      aggregatedTransactions[accountType].credit += credit;
    }

    if (debit) {
      aggregatedTransactions[accountType].debit += debit;
    }

    // Check if there are both credit and debit for the same account
    if (aggregatedTransactions[accountType]?.credit !== 0 && aggregatedTransactions[accountType]?.debit !== 0) {
      const diff = aggregatedTransactions[accountType]?.debit - aggregatedTransactions[accountType]?.credit;

      if (diff > 0) {
        aggregatedTransactions[accountType].credit = diff;
        aggregatedTransactions[accountType].debit = 0;
      } else {
        aggregatedTransactions[accountType].debit = Math.abs(diff);
        aggregatedTransactions[accountType].credit = 0;
      }
    }
  });
  Object.keys(aggregatedTransactions).forEach((key) => {
    if (aggregatedTransactions[key].credit === 0 && aggregatedTransactions[key].debit === 0) {
      delete aggregatedTransactions[key];
    }
  });

  return aggregatedTransactions;
}

function calculateCreditDebitTotal(transactionAggregates) {
  const totals = {
    credit: 0,
    debit: 0,
  };

  Object.values(transactionAggregates).forEach(({ credit, debit }) => {
    totals.credit += credit;
    totals.debit += debit;
  });

  return totals;
}

async function generateTrialBalancePdf(transactions, totals, startDate, endDate) {
  const handleTimeSpan = () => {
    if (startDate && endDate) {
      return `Transactions from ${formatDateUTCtoMMDDYYYY(new Date(startDate))} to ${formatDateUTCtoMMDDYYYY(new Date(endDate))}`;
    }
    return "All Dates";
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];

    // Buffer PDF content
    doc.on("data", (buffer) => buffers.push(buffer));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // add table headers
    doc.moveTo(0,50);
    doc.fontSize(10).text("Trial Balance", { align: "center" }).moveDown();
    doc
        .fontSize(8)
        .text(
         handleTimeSpan(),
          { align: "center"}
        )
        .moveDown();


    const columnTitles = [" ", "Debit", "Credit"];
    const columnOffsets = [10, 250, 440];

    columnTitles.forEach((title, i) => {
      doc.text(title, columnOffsets[i], 110);
    });

    doc.lineWidth(0.5); // Set line weight to 0.5 (adjust as needed)
    doc.moveTo(10, 120).lineTo(600, 120).stroke(); // Line above the first row

    let yOffset = 130;
    Object.entries(transactions).forEach((transaction) => {
      
      doc.text(transaction[0], columnOffsets[0], yOffset);
      doc.text(transaction[1].debit?.toFixed(2), columnOffsets[1], yOffset);
      doc.text(transaction[1].credit?.toFixed(2), columnOffsets[2], yOffset);
      yOffset += 20;
    });

    doc.moveTo(10, yOffset).lineTo(600, yOffset).stroke(); // Line below the last row

    yOffset += 20;

    // Print totals
    doc.text("Total", columnOffsets[0], yOffset);
    doc.text(totals.debit?.toFixed(2), columnOffsets[1], yOffset);
    doc.text(totals.credit?.toFixed(2), columnOffsets[2], yOffset);
    doc.end();
  });
}

function formatDateUTCtoMMDDYYYY(utcDate) {
  const date = new Date(utcDate);
  const mm = date.getUTCMonth() + 1; // getMonth() is zero-based
  const dd = date.getUTCDate();
  const yyyy = date.getUTCFullYear();

  return `${mm.toString().padStart(2, '0')}/${dd.toString().padStart(2, '0')}/${yyyy}`;
}

module.exports = {
  generateTrialBalance,
};
