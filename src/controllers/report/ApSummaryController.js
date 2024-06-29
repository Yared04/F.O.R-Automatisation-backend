const PDFDocument = require("pdfkit");
const { Readable } = require("stream");
const prisma = require("../../database");

async function generateApAgingSummary(req, res) {
  try {
    const { endDate } = req.query; // Assuming the end date is passed in the request body

    // Use the provided end date or default to the current date
    const currentDate = endDate ? new Date(endDate) : new Date();
    
    let accountPayableType = await prisma.accountType.findMany({
      where:{
        name:"Accounts Payable(A/P)"
      }
    });

    if (accountPayableType.length === 0) {
      return res
        .status(404)
        .json({
          error: "No Accounts Payable (A/P) account type found.",
        });
    }

    accountPayableType = accountPayableType.map(item=>item.id);

    // Find the Chart of Account for Accounts Payable (A/P)
    let arChartOfAccount = await prisma.chartOfAccount.findMany({
      where: {
       accountTypeId: {
        in:accountPayableType
       }
      },
    });

    if (arChartOfAccount.length === 0) {
      return res
        .status(404)
        .json({
          error: "Accounts Payable (A/P) chart of account not found.",
        });
    }

    arChartOfAccount = arChartOfAccount.map(item=> item.id);

    // Find all transactions related to the Accounts Receivable (A/P) chart of account
    const arTransactions = await prisma.CATransaction.findMany({
      where: {
        chartofAccountId:{
          in: arChartOfAccount
        },
        date: {
          lte: currentDate, // Filter transactions up to the end date
        },
      },
      include: {
        supplier: true,
      },
    });
    // Categorize transactions into aging buckets
    const agingBuckets = categorizeApAgingTransactions(
      arTransactions,
      currentDate
    );

    // Calculate credit amounts for each aging bucket
    const creditTotals = calculateApAgingCreditTotals(agingBuckets);

    // Generate PDF content
    const pdfContent = await generateApAgingPDFContent(
      agingBuckets,
      creditTotals,
      currentDate
    );

    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="A/P-aging-summary.pdf"'
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

function categorizeApAgingTransactions(transactions, currentDate) {
  const agingBuckets = {};

  transactions.forEach((transaction) => {
    const { supplier, date, credit, usdAmount, ExchangeRate  } = transaction;
    const daysDifference = Math.ceil(
      (currentDate - new Date(date)) / (1000 * 60 * 60 * 24)
    );
    const bucket = getBucket(daysDifference);

    const supplierKey = `${supplier.name}`;

    if (!agingBuckets[supplierKey]) {
      agingBuckets[supplierKey] = {
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        over90: 0,
      };
    }

    if(usdAmount) {
      agingBuckets[supplierKey][bucket] += usdAmount * exchangeRate || 0;
    }
    else{
      agingBuckets[supplierKey][bucket] += credit || 0;
    }
  });

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

function calculateApAgingCreditTotals(agingBuckets) {
  const creditTotals = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    over90: 0,
  };

  Object.values(agingBuckets).forEach((supplier) => {
    Object.keys(creditTotals).forEach((bucket) => {
      creditTotals[bucket] += supplier[bucket];
    });
  });

  return creditTotals;
}

async function generateApAgingPDFContent(
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
    doc.fontSize(15).text("A/P Ageing Summary", { align: "center" }).moveDown();
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
    let xOffset = 20;
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

    doc.moveTo(20, 145).lineTo(600, 145).stroke(); // Line above the first row
    doc.moveTo(20, 165).lineTo(600, 165).stroke(); // Line above the first row
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

    Object.keys(agingBuckets).forEach((supplier) => {
      xOffset = 20;
      doc.font("Helvetica").text(supplier, xOffset, yOffset);
      xOffset += 80;
      let rowTotal = 0; // Total sum for the current row
      Object.keys(agingBuckets[supplier]).forEach((bucket) => {
        const value = agingBuckets[supplier][bucket];
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
      yOffset += 30; // Move to the next row
    });

    doc
      .moveTo(20, yOffset - 10)
      .lineTo(600, yOffset - 10)
      .stroke(); // Line above the last row
    doc.lineWidth(1.5); // Set line weight to 2 (adjust as needed)
    doc
      .moveTo(20, yOffset + 15)
      .lineTo(600, yOffset + 15)
      .stroke(); // Line below the last row
    // Add totals row
    xOffset = 20;
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

module.exports ={
  generateApAgingSummary
}