const PDFDocument = require("pdfkit");
const { Readable } = require("stream");
const prisma = require("../../database");

async function generateCustomerAgingSummary(req, res) {
  try {
    const { endDate } = req.query; // Assuming the end date is passed in the request body

    // Use the provided end date or default to the current date
    const currentDate = endDate ? new Date(endDate) : new Date();

    // Find the Chart of Account for Accounts Receivable (A/R)
    const arChartOfAccount = await prisma.chartOfAccount.findFirst({
      where: {
        name: "Accounts Receivable (A/R)",
      },
    });

    if (!arChartOfAccount) {
      return res
        .status(404)
        .json({
          error: "Accounts Receivable (A/R) chart of account not found.",
        });
    }

    // Find all transactions related to the Accounts Receivable (A/R) chart of account
    const arTransactions = await prisma.CATransaction.findMany({
      where: {
        chartofAccountId: arChartOfAccount.id,
        date: {
          lte: currentDate, // Filter transactions up to the end date
        },
      },
      include: {
        customer: true,
      },
    });

    const customerIds = arTransactions.map((transaction) => transaction.customer.id);

    const paidAmounts = await prisma.sale.findMany({
      where: {
        customerId: {
          in: customerIds,
        },
      },
      include:{
        customer: true,
      }
    });


    // Categorize transactions into aging buckets
    const agingBuckets = categorizeARAgingTransactions(
      arTransactions,
      paidAmounts,
      currentDate
    );

    // Calculate credit amounts for each aging bucket
    const creditTotals = calculateArAgingCreditTotals(agingBuckets);

    // Generate PDF content
    const pdfContent = await generateARAgingPDFContent(
      agingBuckets,
      creditTotals,
      currentDate
    );

    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="A/R-aging-summary.pdf"'
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

function categorizeARAgingTransactions(transactions,paidAmount, currentDate) {
  const agingBuckets = {};

  transactions.forEach((transaction) => {
    const { customer, date, credit } = transaction;
    const daysDifference = Math.ceil(
      (currentDate - new Date(date)) / (1000 * 60 * 60 * 24)
    );
    const bucket = getBucket(daysDifference);

    const customerKey = `${customer.firstName} ${customer.lastName}`;

    if (!agingBuckets[customerKey]) {
      agingBuckets[customerKey] = {
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        over90: 0,
      };
    }

    agingBuckets[customerKey][bucket] += credit || 0;
  });
  paidAmount.forEach(
    (sale) => {
      const { customer, createdAt, paidAmount } = sale;
      const daysDifference = Math.ceil(
        (currentDate - new Date(createdAt)) / (1000 * 60 * 60 * 24)
      );
      const bucket = getBucket(daysDifference);
  
      const customerKey = `${customer.firstName} ${customer.lastName}`;
  
      if (!agingBuckets[customerKey]) {
        agingBuckets[customerKey] = {
          current: 0,
          days1to30: 0,
          days31to60: 0,
          days61to90: 0,
          over90: 0,
        };
      }
  
      agingBuckets[customerKey][bucket] -= paidAmount || 0;
    }
  )


  return agingBuckets;
}

function getBucket(daysDifference) {
  if (daysDifference <= 30) {
    return "current";
  } else if (daysDifference <= 60) {
    return "days1to30";
  } else if (daysDifference <= 90) {
    return "days31to60";
  } else if (daysDifference <= 90) {
    return "days61to90";
  } else {
    return "over90";
  }
}

function calculateArAgingCreditTotals(agingBuckets) {
  const creditTotals = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    over90: 0,
  };

  Object.values(agingBuckets).forEach((customer) => {
    Object.keys(creditTotals).forEach((bucket) => {
      creditTotals[bucket] += customer[bucket];
    });
  });

  return creditTotals;
}

async function generateARAgingPDFContent(
  agingBuckets,
  creditTotals,
  currentDate
) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];

    // Buffer PDF content
    doc.on("data", (buffer) => buffers.push(buffer));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // Add report title and date
    doc.fontSize(15).text("A/R Ageing Summary", { align: "center" }).moveDown();
    doc
      .fontSize(11)
      .text(
        `As of ${currentDate.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}`,
        { align: "center" }
      )
      .moveDown();

    // Add table headers
    doc.fontSize(7)

    let xOffset = 30;
    xOffset += 80;
    doc.text("Current", xOffset, 150);
    xOffset += 80;
    doc.text("1 - 30", xOffset, 150);
    xOffset += 80;
    doc.text("31 - 60", xOffset, 150);
    xOffset += 80;
    doc.text("61 - 90", xOffset, 150);
    xOffset += 80;
    doc.text("Over 90", xOffset, 150);
    xOffset += 80;
    doc.text("Total", xOffset, 150);

    doc.lineWidth(0.5); // Set line weight to 2 (adjust as needed)

    doc.moveTo(30, 145).lineTo(600, 145).stroke(); // Line above the first row
    doc.moveTo(30, 165).lineTo(600, 165).stroke(); // Line above the first row
    // Add data rows
    let yOffset = 190;
    let totalColumnSum = 0; // Total sum of the "Total" column
    const totals = {
      // Object to store the totals for each column
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      over90: 0,
    };

    Object.keys(agingBuckets).forEach((customer) => {
      xOffset = 30;
      doc.font("Helvetica").text(customer, xOffset, yOffset);
      xOffset += 80;
      let rowTotal = 0; // Total sum for the current row
      Object.keys(agingBuckets[customer]).forEach((bucket) => {
        const value = agingBuckets[customer][bucket];
        doc.text(
          typeof value === "number" ? value.toFixed(2) : value,
          xOffset,
          yOffset
        );
        xOffset += 80;
        if (bucket !== "Total") {
          rowTotal += value; // Accumulate the row total
          totals[bucket] += value; // Accumulate column totals
        }
      });
      doc.text(rowTotal.toFixed(2), xOffset, yOffset); // Display row total
      totalColumnSum += rowTotal; // Accumulate row total to total column sum
      yOffset += 20; // Move to the next row
    });

    doc
      .moveTo(30, yOffset - 10)
      .lineTo(600, yOffset - 10)
      .stroke(); // Line above the last row
    doc.lineWidth(1.5); // Set line weight to 2 (adjust as needed)
    doc
      .moveTo(30, yOffset + 10)
      .lineTo(600, yOffset + 10)
      .stroke(); // Line below the last row
    // Add totals row
    xOffset = 30;
    doc.font("Helvetica-Bold").text("Total", xOffset, yOffset);
    xOffset += 80;
    Object.keys(totals).forEach((bucket) => {
      doc.text(totals[bucket].toFixed(2), xOffset, yOffset);
      xOffset += 80;
    });
    doc.text(totalColumnSum.toFixed(2), xOffset, yOffset); // Display total column sum

    doc.end();
  });
}

async function generateBankTransactionSummary(req, res) {
  try {
    // Retrieve bank ID and optional start/end dates from the request
    const { bankId, startDate, endDate } = req.query;
    // Retrieve bank details
    const bank = await prisma.bank.findUnique({
      where: {
        id: bankId,
      },
    });

    if (!bank) {
      return res.status(404).json({ error: "Bank not found" });
    }

    // Retrieve bank transactions based on bank ID and optional start/end dates
    let transactionFilter = {
      bankId: bankId,
    };

    if (startDate && endDate) {
      transactionFilter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const bankTransactions = await prisma.bankTransaction.findMany({
      where: transactionFilter,
      include: {
        chartofAccount: true,
      },
    });

    // Generate PDF content for the bank transactions
    const pdfContent = await generateBankTransactionPDFContent(
      bank,
      bankTransactions,
      startDate,
      endDate
    );

    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bank-transaction-summary.pdf"'
    );

    // Send the PDF content to the client
    res.send(pdfContent);
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
}

async function generateBankTransactionPDFContent(
  bank,
  bankTransactions,
  startDate,
  endDate
) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape" }); // Set layout to landscape
    const buffers = [];

    // Buffer PDF content
    doc.on("data", (buffer) => buffers.push(buffer));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // Add bank name to the PDF
    doc.fontSize(15).text(`Bank: ${bank.name}`, { align: "center" }).moveDown();

    // Add date interval or date below the bank name
    let dateText = "";
    if (startDate && endDate) {
      dateText = `Transactions from ${formatDate(startDate)} to ${formatDate(
        endDate
      )}`;
    } else {
      dateText = `Transactions as of ${formatDate(new Date())}`;
    }
    doc.fontSize(10).text(dateText, { align: "center" }).moveDown();

    doc.fontSize(7);
    // Add table headers
    let xOffset = 40;
    doc.text("Date", xOffset, 150);
    xOffset += 80;
    doc.text("Payee", xOffset, 150);
    xOffset += 80;
    doc.text("Foreign Currency", xOffset, 150);
    xOffset += 80;
    doc.text("Balance", xOffset, 150);
    xOffset += 80;
    doc.text("Payment", xOffset, 150);
    xOffset += 80;
    doc.text("Deposit", xOffset, 150);
    xOffset += 80;
    doc.text("Type", xOffset, 150);
    xOffset += 80;
    doc.text("Chart of Account", xOffset, 150);
    xOffset += 100;
    doc.text("Exchange Rate", xOffset, 150);

    doc.lineWidth(0.5); // Set line weight to 0.5

    doc.moveTo(40, 145).lineTo(800, 145).stroke(); // Line above the headers
    doc.moveTo(40, 165).lineTo(800, 165).stroke(); // Line below the headers

    // Add data rows
    let yOffset = 190;
    bankTransactions.forEach((transaction) => {
      xOffset = 40;
      doc
        .font("Helvetica")
        .text(formatDate(transaction.createdAt), xOffset, yOffset);
      xOffset += 80;
      doc.text(transaction.payee || "", xOffset, yOffset);
      xOffset += 80;
      doc.text(
        transaction.foreignCurrency
          ? transaction.foreignCurrency.toFixed(2)
          : "",
        xOffset,
        yOffset
      );
      xOffset += 80;
      doc.text(
        transaction.balance ? transaction.balance.toFixed(2) : "",
        xOffset,
        yOffset
      );
      xOffset += 80;
      doc.text(
        transaction.payment ? transaction.payment.toFixed(2) : "",
        xOffset,
        yOffset
      );
      xOffset += 80;
      doc.text(
        transaction.deposit ? transaction.deposit.toFixed(2) : "",
        xOffset,
        yOffset
      );
      xOffset += 80;
      doc.text(transaction.type || "", xOffset, yOffset);
      xOffset += 80;
      doc.text(transaction.chartofAccount?.name || "", xOffset, yOffset);
      xOffset += 100;
      doc.text(
        transaction.exchangeRate ? transaction.exchangeRate.toFixed(2) : "",
        xOffset,
        yOffset
      );
      yOffset += 20; // Move to the next row
    });

    doc.lineWidth(1.5); // Set line weight to 1.5
    doc
      .moveTo(40, yOffset + 10)
      .lineTo(800, yOffset + 10)
      .stroke(); // Line below the last row

    doc.end();
  });
}

// Utility function to format date
function formatDate(date) {
  return date ? new Date(date).toLocaleDateString("en-US") : "";
}

module.exports = {
  generateCustomerAgingSummary,
  generateBankTransactionSummary,
};
