const invoiceTemplate = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Tax Invoice</title>

<style>
  @page {
    size: A4;
    margin: 12mm;
  }

  body {
    margin: 0;
    font-family: "Times New Roman", serif;
    background: #f2f2f2;
  }

  .page {
    width: 210mm;
    min-height: 297mm;
    background: #fff;
    margin: auto;
    padding: 10mm;
    box-sizing: border-box;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  td, th {
    border: 1px solid #000;
    padding: 4px;
    font-size: 11px;
    vertical-align: top;
  }

  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: bold; }

  .title {
    font-size: 16px;
    font-weight: bold;
  }

  .subtitle {
    font-size: 13px;
    font-weight: bold;
  }

  .small {
    font-size: 10px;
  }

  .print-btn {
    position: fixed;
    top: 10px;
    right: 10px;
    padding: 8px 14px;
    font-size: 14px;
    cursor: pointer;
  }

  @media print {
    .print-btn { display: none; }
    body { background: white; }
  }
</style>
</head>

<body>

<button class="print-btn" onclick="window.print()">Print</button>

<div class="page">

<!-- HEADER -->
<table>
  <tr>
    <td class="center bold title">TAX INVOICE</td>
  </tr>
  <tr>
    <td class="center bold subtitle">&lt;&lt;COMPANY_NAME&gt;&gt;</td>
  </tr>
  <tr>
    <td class="center small bold">
      &lt;&lt;COMPANY_ADDRESS&gt;&gt;<br>
      Ph: &lt;&lt;COMPANY_PHONE&gt;&gt; | Email: &lt;&lt;COMPANY_EMAIL&gt;&gt;
    </td>
  </tr>
  <tr>
    <td class="center small bold">
      &lt;&lt;MSME_LINE&gt;&gt;
    </td>
  </tr>
</table>

<br>

<!-- GSTIN / GST -->
<table>
  <tr>
    <td class="bold">GSTIN: &lt;&lt;GSTIN&gt;&gt;</td>
    <td class="bold">GST: &lt;&lt;GST&gt;&gt;</td>
  </tr>
</table>

<!-- RECEIVER + INVOICE INFO -->
<table>
  <tr>
    <td width="60%">
      <strong>&lt;&lt;RECEIVER_NAME&gt;&gt;</strong><br>
      &lt;&lt;RECEIVER_ADDRESS&gt;&gt;
    </td>
    <td width="40%">
      <strong>Invoice No:</strong> &lt;&lt;INVOICE_NO&gt;&gt;<br>
      <strong>Date:</strong> &lt;&lt;INVOICE_DATE&gt;&gt;
    </td>
  </tr>
</table>

<!-- ITEMS -->
<table>
  <tr class="bold center">
    <td width="5%">S.No</td>
    <td width="35%">Description</td>
    <td width="10%">HSN</td>
    <td width="8%">Qty</td>
    <td width="8%">Unit</td>
    <td width="12%">Rate</td>
    <td width="12%">Amount (₹)</td>
  </tr>

  {{ITEM_ROWS}}

</table>

<!-- TOTALS -->
<table>
  <tr>
    <td width="60%">
      <strong>In Words:</strong><br>
      &lt;&lt;AMOUNT_IN_WORDS&gt;&gt;
    </td>
    <td width="40%">
      <table>
        <tr><td>Total</td><td class="right">&lt;&lt;SUB_TOTAL&gt;&gt;</td></tr>
        <tr><td>CGST @ &lt;&lt;CGST_RATE&gt;&gt;%</td><td class="right">&lt;&lt;CGST_AMOUNT&gt;&gt;</td></tr>
        <tr><td>SGST @ &lt;&lt;SGST_RATE&gt;&gt;%</td><td class="right">&lt;&lt;SGST_AMOUNT&gt;&gt;</td></tr>
        <tr class="bold"><td>Grand Total</td><td class="right">&lt;&lt;GRAND_TOTAL&gt;&gt;</td></tr>
      </table>
    </td>
  </tr>
</table>

<!-- FOOTER -->
<table>
  <tr>
    <td width="60%">
      <strong>Bank Details</strong><br>
      Bank: &lt;&lt;BANK_NAME&gt;&gt;<br>
      IFSC: &lt;&lt;BANK_IFSC&gt;&gt;<br>
      Account No: &lt;&lt;BANK_ACCOUNT&gt;&gt;
    </td>
    <td width="40%" class="center">
      For &lt;&lt;COMPANY_NAME&gt;&gt;<br><br>
      <strong>Authorised Signatory</strong>
    </td>
  </tr>
</table>

</div>
</body>
</html>`;

module.exports = { invoiceTemplate };
