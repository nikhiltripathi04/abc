const mongoose = require('mongoose');
const { SalesRequest } = require('../models/SalesRequest');
const { ApprovalLog } = require('../models/ApprovalLog');
const InventoryItem = require('../models/InventoryItem');
const Warehouse = require('../models/Warehouse');
const Company = require('../models/Company');
const { getNextSequence, formatNumber } = require('../utils/generateOrderId');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const toTrimmed = (value) => String(value || '').trim();
const safeUserName = (user) => user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username || 'Unknown';

const salesRequestDetailPopulate = (query) => query
    .populate('warehouseId', 'warehouseName')
    .populate('createdBy', 'fullName firstName lastName email username')
    .populate('approvedBy', 'fullName firstName lastName email username')
    .populate('rejectedBy', 'fullName firstName lastName email username')
    .populate('items.inventoryItemId');

const canCreateSalesRequest = (role) => ['admin', 'company_owner', 'warehouse_manager'].includes(role);
const canApproveSalesRequest = (role) => ['admin', 'company_owner'].includes(role);

const assertCompanyAccess = (user, companyId) => {
    if (!companyId || !user?.companyId) return false;
    return String(companyId) === String(user.companyId);
};

const getWarehouseManagerWarehouseIds = (user) => {
    const ids = [];
    if (user?.warehouseId) ids.push(String(user.warehouseId));
    if (Array.isArray(user?.assignedWarehouses)) {
        user.assignedWarehouses.forEach((id) => {
            if (id) ids.push(String(id));
        });
    }
    return [...new Set(ids)];
};

const warehouseManagerHasAccess = (user, warehouseId) => {
    if (user?.role !== 'warehouse_manager') return true;
    const allowed = getWarehouseManagerWarehouseIds(user);
    if (!allowed.length) return false;
    return allowed.some((id) => id === String(warehouseId));
};

const getWarehouseForUser = async (warehouseId, user) => {
    if (!warehouseId || !mongoose.isValidObjectId(warehouseId)) return null;
    if (!warehouseManagerHasAccess(user, warehouseId)) return null;

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) return null;
    if (!assertCompanyAccess(user, warehouse.companyId)) return null;
    return warehouse;
};

const generateSalesRequestId = async () => {
    const year = new Date().getFullYear();
    const sequence = await getNextSequence(`sales_request_${year}`);
    return `DSR-${year}-${formatNumber(sequence, 6)}`;
};

const generateInvoiceNumber = async () => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let i = 0; i < 10; i += 1) {
        const rand = Math.floor(1000 + Math.random() * 9000);
        const candidate = `INV-${stamp}-${rand}`;
        // eslint-disable-next-line no-await-in-loop
        const exists = await SalesRequest.exists({ 'invoice.number': candidate });
        if (!exists) return candidate;
    }
    throw new Error('Unable to generate invoice number. Please retry.');
};

const collectItemIds = (items) => {
    if (!Array.isArray(items)) return [];
    return items
        .map((item) => item?.inventoryItemId || item?.itemId)
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));
};

const fetchInventoryMap = async (warehouseId, items) => {
    const itemIds = collectItemIds(items);
    if (!itemIds.length) {
        return { error: 'At least one valid item is required.' };
    }

    const inventoryItems = await InventoryItem.find({
        warehouseId,
        _id: { $in: itemIds }
    }).select('itemName uid uom availableQty currentPrice entryPrice currency').lean();

    const inventoryMap = new Map(inventoryItems.map((item) => [String(item._id), item]));
    if (inventoryMap.size !== itemIds.length) {
        return { error: 'One or more items were not found in the selected warehouse inventory.' };
    }

    return { inventoryMap };
};

const getRequestedQty = (item) => {
    const raw = item?.requestedQty ?? item?.quantity ?? item?.qty;
    return Math.max(0, toNumber(raw, 0));
};

const getApprovedQty = (item, fallback) => {
    if (item?.approvedQty !== undefined && item?.approvedQty !== null && item?.approvedQty !== '') {
        return Math.max(0, toNumber(item.approvedQty, fallback));
    }
    return Math.max(0, toNumber(fallback, 0));
};

const normalizeSalesItems = ({ items, inventoryMap, mode }) => {
    if (!Array.isArray(items) || items.length === 0) {
        return { error: 'At least one item is required.' };
    }

    const normalized = [];
    for (const item of items) {
        const itemId = item?.inventoryItemId || item?.itemId;
        if (!mongoose.isValidObjectId(itemId)) {
            return { error: 'Invalid itemId provided.' };
        }

        const inv = inventoryMap.get(String(itemId));
        if (!inv) {
            return { error: 'Inventory item not found for provided itemId.' };
        }

        const requestedQty = getRequestedQty(item);
        if (!requestedQty) {
            return { error: 'Item quantity must be greater than 0.' };
        }

        let approvedQty = 0;
        if (mode === 'approve') {
            approvedQty = getApprovedQty(item, requestedQty);

            if (approvedQty > requestedQty) {
                return { error: `Approved qty cannot be greater than requested qty for ${inv.itemName}` };
            }

            if (approvedQty < 0) {
                return { error: `Approved qty cannot be negative for ${inv.itemName}` };
            }
        }

        const price = Math.max(0, toNumber(item?.price, inv.currentPrice || inv.entryPrice || 0));
        const effectiveQty = mode === 'approve' ? approvedQty : requestedQty;
        const lineTotal = Math.max(0, price * effectiveQty);

        let approvalDecision = 'pending';
        if (mode === 'approve') {
            if (approvedQty <= 0) {
                approvalDecision = 'rejected';
            } else if (approvedQty < requestedQty) {
                approvalDecision = 'partial';
            } else {
                approvalDecision = 'approved';
            }
        }

        normalized.push({
            inventoryItemId: new mongoose.Types.ObjectId(itemId),
            itemName: toTrimmed(item?.itemName || inv.itemName),
            itemUid: toTrimmed(item?.itemUid || inv.uid),
            hsnCode: toTrimmed(item?.hsnCode || item?.hsn || ''),
            uom: toTrimmed(item?.uom || inv.uom || ''),
            currency: toTrimmed(inv.currency || '₹'),
            requestedQty,
            approvedQty,
            approvalDecision,
            availableQtySnapshot: Math.max(0, toNumber(inv.availableQty, 0)),
            price,
            lineTotal,
            notes: toTrimmed(item?.notes || '')
        });
    }

    return { items: normalized };
};

const computeTotals = ({ items, discount, freight, cgstPercent, sgstPercent }) => {
    const itemTotal = items.reduce((sum, item) => sum + toNumber(item.lineTotal, 0), 0);
    const safeDiscount = Math.max(0, toNumber(discount, 0));
    const safeFreight = Math.max(0, toNumber(freight, 0));
    const taxableTotal = Math.max(0, itemTotal + safeFreight - safeDiscount);
    const safeCgstPercent = Math.max(0, toNumber(cgstPercent, 0));
    const safeSgstPercent = Math.max(0, toNumber(sgstPercent, 0));
    const cgstAmount = Math.max(0, taxableTotal * (safeCgstPercent / 100));
    const sgstAmount = Math.max(0, taxableTotal * (safeSgstPercent / 100));
    const grandTotal = taxableTotal + cgstAmount + sgstAmount;

    return {
        itemTotal,
        discount: safeDiscount,
        freight: safeFreight,
        taxableTotal,
        cgstPercent: safeCgstPercent,
        sgstPercent: safeSgstPercent,
        cgstAmount,
        sgstAmount,
        grandTotal
    };
};

const buildApprovalLogPayload = (salesRequest, user, status) => {
    const totalItems = (salesRequest.items || []).length;
    const approvedItems = (salesRequest.items || []).filter((item) => item.approvalDecision === 'approved').length;
    const rejectedItems = (salesRequest.items || []).filter((item) => item.approvalDecision === 'rejected').length;
    const partialItems = (salesRequest.items || []).filter((item) => item.approvalDecision === 'partial').length;

    return {
        approvalType: 'sales_request',
        referenceId: salesRequest._id,
        referenceName: salesRequest.salesRequestId,
        companyId: salesRequest.companyId,
        siteId: undefined,
        adminId: user._id,
        adminName: safeUserName(user),
        status,
        totalItems,
        approvedItems,
        rejectedItems,
        partialItems,
        decision: {
            itemTotals: {
                totalItems,
                approvedItems,
                rejectedItems,
                partialItems
            }
        },
        remarks: toTrimmed(
            salesRequest.approvalRemarks ||
            salesRequest.rejectionReason ||
            ''
        )
    };
};

const upsertApprovalLog = async (salesRequest, user, status) => {
    await ApprovalLog.findOneAndUpdate(
        { approvalType: 'sales_request', referenceId: salesRequest._id },
        { $set: buildApprovalLogPayload(salesRequest, user, status) },
        { upsert: true, new: true }
    );
};

const applyTotals = (doc, totals) => {
    doc.itemTotal = totals.itemTotal;
    doc.discount = totals.discount;
    doc.freight = totals.freight;
    doc.taxableTotal = totals.taxableTotal;
    doc.cgstPercent = totals.cgstPercent;
    doc.sgstPercent = totals.sgstPercent;
    doc.cgstAmount = totals.cgstAmount;
    doc.sgstAmount = totals.sgstAmount;
    doc.grandTotal = totals.grandTotal;
};

const buildListScope = (user) => {
    if (!user?.companyId) {
        return { error: { code: 403, message: 'User is not mapped to a company' } };
    }

    if (!['admin', 'company_owner', 'warehouse_manager'].includes(user.role)) {
        return { error: { code: 403, message: 'Sales access denied' } };
    }

    const query = { companyId: user.companyId };

    let allowedWarehouseIds = [];
    if (user.role === 'warehouse_manager') {
        // Support both legacy warehouseId and new assignedWarehouses array
        const warehouses = [];
        if (user.warehouseId) warehouses.push(user.warehouseId);
        if (user.assignedWarehouses && user.assignedWarehouses.length > 0) {
            warehouses.push(...user.assignedWarehouses);
        }
        
        if (warehouses.length === 0) {
            return { error: { code: 403, message: 'Warehouse manager is not mapped to any warehouse' } };
        }
        allowedWarehouseIds = warehouses
            .map((id) => String(id))
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        // If multiple warehouses, use $in query, otherwise use direct match
        query.warehouseId = allowedWarehouseIds.length > 1 ? { $in: allowedWarehouseIds } : allowedWarehouseIds[0];
    }

    return { query, allowedWarehouseIds };
};

const buildInvoiceConfig = (company) => {
    const config = company?.salesInvoiceConfig || {};
    return {
        companyName: config.companyName || company?.name || '',
        companyAddress: config.companyAddress || company?.address || '',
        companyNumber: config.companyNumber || company?.phoneNumber || '',
        companyEmail: config.companyEmail || company?.email || '',
        msmeField: config.msmeField || '',
        udyamRegNo: config.udyamRegNo || '',
        udyamDl: config.udyamDl || '',
        companyType: config.companyType || '',
        activities: config.activities || '',
        stateCode: config.stateCode || '',
        termsAndConditions: config.termsAndConditions || '',
        gstNo: config.gstNo || company?.gstin || '',
        authorizedSignatory: config.authorizedSignatory || '',
        bankName: config.bankName || '',
        bankIfsc: config.bankIfsc || '',
        bankAccount: config.bankAccount || ''
    };
};

const { invoiceTemplate } = require('../templates/invoiceTemplate');
const puppeteer = require('puppeteer');

const formatAmount = (value) => {
    const normalized = typeof value === 'string' ? value.replace(/,/g, '') : value;
    const num = Number(normalized || 0);
    return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

const escapeHtml = (value) => {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const numberToWordsInr = (amount) => {
    const num = Number(amount || 0);
    if (!Number.isFinite(num)) {
        return '-';
    }

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', 'Ten', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    const toWordsBelow100 = (n) => {
        if (n < 10) return ones[n];
        if (n < 20) return teens[n - 10];
        return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`.trim();
    };

    const toWordsBelow1000 = (n) => {
        const hundred = Math.floor(n / 100);
        const remainder = n % 100;
        if (!hundred) return toWordsBelow100(remainder);
        if (!remainder) return `${ones[hundred]} Hundred`;
        return `${ones[hundred]} Hundred ${toWordsBelow100(remainder)}`;
    };

    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);

    const parts = [];
    let remaining = rupees;

    const crore = Math.floor(remaining / 10000000);
    if (crore) {
        parts.push(`${toWordsBelow1000(crore)} Crore`);
        remaining %= 10000000;
    }

    const lakh = Math.floor(remaining / 100000);
    if (lakh) {
        parts.push(`${toWordsBelow1000(lakh)} Lakh`);
        remaining %= 100000;
    }

    const thousand = Math.floor(remaining / 1000);
    if (thousand) {
        parts.push(`${toWordsBelow1000(thousand)} Thousand`);
        remaining %= 1000;
    }

    if (remaining) {
        parts.push(toWordsBelow1000(remaining));
    }

    const rupeesWords = parts.length ? parts.join(' ') : 'Zero';
    const paiseWords = paise ? `${toWordsBelow100(paise)} Paise` : '';
    return `${rupeesWords} Rupees${paiseWords ? ` and ${paiseWords}` : ''} Only`;
};

const buildInvoiceHtml = ({ salesRequest, company }) => {
    const config = buildInvoiceConfig(company);
    const invoiceNumber = salesRequest.invoice?.number || salesRequest.salesRequestId;
    const invoiceDate = salesRequest.invoice?.generatedAt
        ? new Date(salesRequest.invoice.generatedAt)
        : new Date();

    const items = salesRequest.items || [];
    const itemRows = items
        .map((item, index) => {
            const requestedQty = toNumber(item?.requestedQty ?? item?.quantity ?? item?.qty, 0);
            const approvedQty = (item?.approvedQty !== undefined && item?.approvedQty !== null)
                ? toNumber(item.approvedQty, requestedQty)
                : requestedQty;
            const qty = approvedQty || requestedQty || 0;
            const price = toNumber(item?.price, 0);
            const amount = toNumber(item?.lineTotal, price * qty);
            return `
  <tr>
    <td class="center">${index + 1}</td>
    <td>${escapeHtml(item.itemName || '-')}${item.itemUid ? ` (${escapeHtml(item.itemUid)})` : ''}</td>
    <td class="center">${escapeHtml(item.hsnCode || '-')}</td>
    <td class="center">${escapeHtml(qty)}</td>
    <td class="center">${escapeHtml(item.uom || '')}</td>
    <td class="right">${escapeHtml(formatAmount(price))}</td>
    <td class="right">${escapeHtml(formatAmount(amount))}</td>
  </tr>`;
        })
        .join('');

    const replacements = {
        COMPANY_NAME: config.companyName || 'Company',
        COMPANY_ADDRESS: config.companyAddress || '',
        COMPANY_PHONE: config.companyNumber || '',
        COMPANY_EMAIL: config.companyEmail || '',
        MSME_LINE: config.msmeField || '',
        GSTIN: config.gstNo || '',
        GST: config.gstNo || '',
        RECEIVER_NAME: salesRequest.customer?.name || '-',
        RECEIVER_ADDRESS: salesRequest.customer?.address || '-',
        INVOICE_NO: invoiceNumber || '-',
        INVOICE_DATE: invoiceDate.toLocaleDateString('en-IN'),
        AMOUNT_IN_WORDS: numberToWordsInr(salesRequest.grandTotal),
        SUB_TOTAL: formatAmount(salesRequest.taxableTotal ?? salesRequest.itemTotal),
        CGST_RATE: salesRequest.cgstPercent ?? 0,
        CGST_AMOUNT: formatAmount(salesRequest.cgstAmount),
        SGST_RATE: salesRequest.sgstPercent ?? 0,
        SGST_AMOUNT: formatAmount(salesRequest.sgstAmount),
        GRAND_TOTAL: formatAmount(salesRequest.grandTotal),
        BANK_NAME: config.bankName || '',
        BANK_IFSC: config.bankIfsc || '',
        BANK_ACCOUNT: config.bankAccount || ''
    };

    let html = invoiceTemplate.replace('{{ITEM_ROWS}}', itemRows || '');
    Object.entries(replacements).forEach(([key, value]) => {
        const safeValue = escapeHtml(value);
        html = html.replaceAll(`<<${key}>>`, safeValue);
        html = html.replaceAll(`&lt;&lt;${key}&gt;&gt;`, safeValue);
    });

    return html;
};

const generateInvoicePdfBuffer = async ({ salesRequest, company }) => {
    const html = buildInvoiceHtml({ salesRequest, company });
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.emulateMediaType('print');
        return await page.pdf({
            format: 'A4',
            printBackground: true
        });
    } finally {
        await browser.close();
    }
};

exports.createSalesRequest = async (req, res) => {
    try {
        const user = req.user;
        if (!canCreateSalesRequest(user.role)) {
            return res.status(403).json({ success: false, message: 'You are not allowed to create sales requests' });
        }
        if (!user.companyId) {
            return res.status(403).json({ success: false, message: 'User is not mapped to a company' });
        }

        const {
            warehouseId,
            items = [],
            customer = {},
            notes,
            discount,
            freight,
            cgstPercent,
            sgstPercent,
            asDraft = true
        } = req.body || {};

        const effectiveWarehouseId = warehouseId || user.warehouseId;
        const warehouse = await getWarehouseForUser(effectiveWarehouseId, user);
        if (!warehouse) {
            return res.status(403).json({ success: false, message: 'Warehouse access denied or not found' });
        }

        // Check if warehouse manager has access to this warehouse
        if (user.role === 'warehouse_manager') {
            const hasAccess = 
                (user.warehouseId && String(user.warehouseId) === String(warehouse._id)) ||
                (user.assignedWarehouses && user.assignedWarehouses.some(wId => String(wId) === String(warehouse._id)));
            
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Warehouse manager can only create requests for their assigned warehouse(s)' });
            }
        }

        let normalizedItems = [];
        if (items.length > 0) {
            const { inventoryMap, error } = await fetchInventoryMap(warehouse._id, items);
            if (error) {
                return res.status(400).json({ success: false, message: error });
            }

            const normalized = normalizeSalesItems({ items, inventoryMap, mode: 'draft' });
            if (normalized.error) {
                return res.status(400).json({ success: false, message: normalized.error });
            }
            normalizedItems = normalized.items;
        } else if (!asDraft) {
            return res.status(400).json({ success: false, message: 'At least one item is required to submit for approval' });
        }

        const totals = computeTotals({
            items: normalizedItems,
            discount,
            freight,
            cgstPercent,
            sgstPercent
        });

        const status = asDraft ? 'draft' : 'pending_approval';
        const salesRequest = await SalesRequest.create({
            salesRequestId: await generateSalesRequestId(),
            companyId: user.companyId,
            warehouseId: warehouse._id,
            status,
            customer: {
                name: toTrimmed(customer?.name || ''),
                number: toTrimmed(customer?.number || ''),
                address: toTrimmed(customer?.address || ''),
                gst: toTrimmed(customer?.gst || customer?.pan || '')
            },
            items: normalizedItems,
            notes: toTrimmed(notes),
            createdBy: user._id,
            createdByName: safeUserName(user),
            createdByRole: user.role,
            submittedAt: status === 'pending_approval' ? new Date() : undefined,
            ...totals
        });

        return res.json({ success: true, data: salesRequest });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateDraft = async (req, res) => {
    try {
        const user = req.user;
        const { id } = req.params;

        const salesRequest = await SalesRequest.findById(id);
        if (!salesRequest) {
            return res.status(404).json({ success: false, message: 'Sales request not found' });
        }

        if (!assertCompanyAccess(user, salesRequest.companyId)) {
            return res.status(403).json({ success: false, message: 'Sales request access denied' });
        }

        if (salesRequest.status !== 'draft') {
            return res.status(400).json({ success: false, message: 'Only draft requests can be updated' });
        }

        if (String(salesRequest.createdBy) !== String(user._id) && user.role !== 'admin' && user.role !== 'company_owner') {
            return res.status(403).json({ success: false, message: 'You can only edit your own draft sales requests' });
        }

        const {
            items,
            customer = {},
            notes,
            discount,
            freight,
            cgstPercent,
            sgstPercent
        } = req.body || {};

        let normalizedItems = salesRequest.items || [];
        if (Array.isArray(items)) {
            const { inventoryMap, error } = await fetchInventoryMap(salesRequest.warehouseId, items);
            if (error) {
                return res.status(400).json({ success: false, message: error });
            }

            const normalized = normalizeSalesItems({ items, inventoryMap, mode: 'draft' });
            if (normalized.error) {
                return res.status(400).json({ success: false, message: normalized.error });
            }

            normalizedItems = normalized.items;
        }

        salesRequest.items = normalizedItems;
        salesRequest.customer = {
            name: toTrimmed(customer?.name ?? salesRequest.customer?.name),
            number: toTrimmed(customer?.number ?? salesRequest.customer?.number),
            address: toTrimmed(customer?.address ?? salesRequest.customer?.address),
            gst: toTrimmed(customer?.gst ?? customer?.pan ?? salesRequest.customer?.gst ?? salesRequest.customer?.pan)
        };
        salesRequest.notes = toTrimmed(notes ?? salesRequest.notes);

        const totals = computeTotals({
            items: normalizedItems,
            discount: discount ?? salesRequest.discount,
            freight: freight ?? salesRequest.freight,
            cgstPercent: cgstPercent ?? salesRequest.cgstPercent,
            sgstPercent: sgstPercent ?? salesRequest.sgstPercent
        });
        applyTotals(salesRequest, totals);

        await salesRequest.save();
        return res.json({ success: true, data: salesRequest });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteDraft = async (req, res) => {
    try {
        const user = req.user;
        const { id } = req.params;

        const salesRequest = await SalesRequest.findById(id);
        if (!salesRequest) {
            return res.status(404).json({ success: false, message: 'Sales request not found' });
        }

        if (!assertCompanyAccess(user, salesRequest.companyId)) {
            return res.status(403).json({ success: false, message: 'Sales request access denied' });
        }

        if (salesRequest.status !== 'draft') {
            return res.status(400).json({ success: false, message: 'Only draft requests can be deleted' });
        }

        if (String(salesRequest.createdBy) !== String(user._id) && user.role !== 'admin' && user.role !== 'company_owner') {
            return res.status(403).json({ success: false, message: 'You can only delete your own draft sales requests' });
        }

        await SalesRequest.deleteOne({ _id: id });
        return res.json({ success: true, message: 'Draft deleted successfully' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.submitDraft = async (req, res) => {
    try {
        const user = req.user;
        const { id } = req.params;

        const salesRequest = await SalesRequest.findById(id);
        if (!salesRequest) {
            return res.status(404).json({ success: false, message: 'Sales request not found' });
        }

        if (!assertCompanyAccess(user, salesRequest.companyId)) {
            return res.status(403).json({ success: false, message: 'Sales request access denied' });
        }

        if (salesRequest.status !== 'draft') {
            return res.status(400).json({ success: false, message: 'Only draft requests can be submitted' });
        }

        if (String(salesRequest.createdBy) !== String(user._id) && user.role !== 'admin' && user.role !== 'company_owner') {
            return res.status(403).json({ success: false, message: 'You can only submit your own draft sales requests' });
        }

        const payloadItems = Array.isArray(req.body?.items) ? req.body.items : salesRequest.items.map((item) => ({
            itemId: item.inventoryItemId,
            requestedQty: item.requestedQty,
            price: item.price,
            hsnCode: item.hsnCode,
            uom: item.uom
        }));

        const { inventoryMap, error } = await fetchInventoryMap(salesRequest.warehouseId, payloadItems);
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }

        const normalized = normalizeSalesItems({ items: payloadItems, inventoryMap, mode: 'submit' });
        if (normalized.error) {
            return res.status(400).json({ success: false, message: normalized.error });
        }

        salesRequest.items = normalized.items;

        const totals = computeTotals({
            items: normalized.items,
            discount: req.body?.discount ?? salesRequest.discount,
            freight: req.body?.freight ?? salesRequest.freight,
            cgstPercent: req.body?.cgstPercent ?? salesRequest.cgstPercent,
            sgstPercent: req.body?.sgstPercent ?? salesRequest.sgstPercent
        });
        applyTotals(salesRequest, totals);

        salesRequest.status = 'pending_approval';
        salesRequest.submittedAt = new Date();

        await salesRequest.save();
        return res.json({ success: true, data: salesRequest });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getSalesRequestById = async (req, res) => {
    try {
        const user = req.user;
        const { id } = req.params;

        const salesRequest = await salesRequestDetailPopulate(SalesRequest.findById(id));

        if (!salesRequest) {
            return res.status(404).json({ success: false, message: 'Sales request not found' });
        }

        if (!assertCompanyAccess(user, salesRequest.companyId)) {
            return res.status(403).json({ success: false, message: 'Sales request access denied' });
        }

        // Check warehouse access for warehouse managers (support both single and multiple warehouses)
        if (user.role === 'warehouse_manager') {
            const requestWarehouseId = String(salesRequest.warehouseId?._id || salesRequest.warehouseId);
            const hasAccess = 
                (user.warehouseId && String(user.warehouseId) === requestWarehouseId) ||
                (user.assignedWarehouses && user.assignedWarehouses.some(wId => String(wId) === requestWarehouseId));
            
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Sales request access denied' });
            }
        }

        return res.json({ success: true, data: salesRequest });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.listSalesRequests = async (req, res) => {
    try {
        const user = req.user;
        const scope = buildListScope(user);
        if (scope.error) {
            return res.status(scope.error.code).json({ success: false, message: scope.error.message });
        }

        const query = { ...scope.query };

        if (req.query.warehouseId) {
            const warehouseId = String(req.query.warehouseId).trim();
            if (!mongoose.isValidObjectId(warehouseId)) {
                return res.status(400).json({ success: false, message: 'Invalid warehouseId' });
            }
            if (user.role === 'warehouse_manager' && scope.allowedWarehouseIds?.length) {
                const hasAccess = scope.allowedWarehouseIds.some((id) => String(id) === warehouseId);
                if (!hasAccess) {
                    return res.status(403).json({ success: false, message: 'Warehouse access denied' });
                }
            }
            const warehouse = await getWarehouseForUser(warehouseId, user);
            if (!warehouse) {
                return res.status(403).json({ success: false, message: 'Warehouse access denied' });
            }
            query.warehouseId = warehouse._id;
        }

        const statusParam = toTrimmed(req.query.status);
        if (statusParam) {
            const statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
            if (statuses.length > 0) {
                query.status = { $in: statuses };
                if (statuses.includes('draft') && user.role === 'warehouse_manager') {
                    query.createdBy = user._id;
                }
            }
        } else {
            query.$or = [
                { status: { $ne: 'draft' } },
                { status: 'draft', createdBy: user._id }
            ];
        }

        const limit = Math.min(MAX_LIMIT, Math.max(1, toNumber(req.query.limit, DEFAULT_LIMIT)));
        const page = Math.max(1, toNumber(req.query.page, 1));
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            SalesRequest.find(query)
                .populate('warehouseId', 'warehouseName')
                .populate('createdBy', 'fullName firstName lastName username')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SalesRequest.countDocuments(query)
        ]);

        return res.json({ success: true, data, page, limit, total });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.adminEditRequest = async (req, res) => {
    try {
        const user = req.user;
        if (!canApproveSalesRequest(user.role)) {
            return res.status(403).json({ success: false, message: 'Only admin/company owner can edit requests' });
        }

        const { id } = req.params;
        const salesRequest = await SalesRequest.findById(id);
        if (!salesRequest) {
            return res.status(404).json({ success: false, message: 'Sales request not found' });
        }

        if (!assertCompanyAccess(user, salesRequest.companyId)) {
            return res.status(403).json({ success: false, message: 'Sales request access denied' });
        }

        if (salesRequest.status !== 'pending_approval') {
            return res.status(400).json({ success: false, message: 'Only pending approval requests can be edited' });
        }

        const { items, discount, freight, cgstPercent, sgstPercent, approvalNotes, approvalRemarks } = req.body || {};

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Items are required for admin edit' });
        }

        const { inventoryMap, error } = await fetchInventoryMap(salesRequest.warehouseId, items);
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }

        const normalized = normalizeSalesItems({ items, inventoryMap, mode: 'approve' });
        if (normalized.error) {
            return res.status(400).json({ success: false, message: normalized.error });
        }

        salesRequest.items = normalized.items;
        salesRequest.approvalNotes = toTrimmed(approvalNotes ?? salesRequest.approvalNotes);
        salesRequest.approvalRemarks = toTrimmed(approvalRemarks ?? salesRequest.approvalRemarks);

        const totals = computeTotals({
            items: normalized.items,
            discount: discount ?? salesRequest.discount,
            freight: freight ?? salesRequest.freight,
            cgstPercent: cgstPercent ?? salesRequest.cgstPercent,
            sgstPercent: sgstPercent ?? salesRequest.sgstPercent
        });
        applyTotals(salesRequest, totals);

        await salesRequest.save();
        return res.json({ success: true, data: salesRequest });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.approveRequest = async (req, res) => {
    try {
        const user = req.user;
        if (!canApproveSalesRequest(user.role)) {
            return res.status(403).json({ success: false, message: 'Only admin/company owner can approve requests' });
        }

        const { id } = req.params;
        const salesRequest = await SalesRequest.findById(id);
        if (!salesRequest) {
            return res.status(404).json({ success: false, message: 'Sales request not found' });
        }

        if (!assertCompanyAccess(user, salesRequest.companyId)) {
            return res.status(403).json({ success: false, message: 'Sales request access denied' });
        }

        if (salesRequest.status !== 'pending_approval') {
            return res.status(400).json({ success: false, message: 'Only pending approval requests can be approved' });
        }

        const payloadItems = Array.isArray(req.body?.items) && req.body.items.length > 0
            ? req.body.items
            : salesRequest.items.map((item) => ({
                itemId: item.inventoryItemId,
                requestedQty: item.requestedQty,
                approvedQty: item.requestedQty,
                price: item.price,
                hsnCode: item.hsnCode,
                uom: item.uom
            }));

        const { inventoryMap, error } = await fetchInventoryMap(salesRequest.warehouseId, payloadItems);
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }

        const normalized = normalizeSalesItems({ items: payloadItems, inventoryMap, mode: 'approve' });
        if (normalized.error) {
            return res.status(400).json({ success: false, message: normalized.error });
        }

        let totalApprovedQty = 0;
        for (const item of normalized.items) {
            const inv = inventoryMap.get(String(item.inventoryItemId));
            const approvedQty = Math.max(0, toNumber(item.approvedQty, 0));
            totalApprovedQty += approvedQty;
            if (approvedQty > 0 && toNumber(inv.availableQty, 0) < approvedQty) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${item.itemName}. Available: ${inv.availableQty}`
                });
            }
        }

        for (const item of normalized.items) {
            const approvedQty = Math.max(0, toNumber(item.approvedQty, 0));
            if (approvedQty <= 0) continue;
            const inv = await InventoryItem.findById(item.inventoryItemId);
            if (!inv) {
                return res.status(400).json({ success: false, message: `Inventory item not found for ${item.itemName}` });
            }
            const newAvailableQty = Math.max(0, toNumber(inv.availableQty, 0) - approvedQty);
            inv.availableQty = newAvailableQty;
            item.availableQtySnapshot = newAvailableQty;
            // eslint-disable-next-line no-await-in-loop
            await inv.save();
        }

        salesRequest.items = normalized.items;
        salesRequest.approvalNotes = toTrimmed(req.body?.approvalNotes ?? salesRequest.approvalNotes);
        salesRequest.approvalRemarks = toTrimmed(req.body?.approvalRemarks ?? salesRequest.approvalRemarks);

        if (totalApprovedQty <= 0) {
            salesRequest.status = 'rejected';
            salesRequest.rejectedBy = user._id;
            salesRequest.rejectedByName = safeUserName(user);
            salesRequest.rejectedAt = new Date();
            salesRequest.rejectionReason = toTrimmed(req.body?.rejectionReason || 'All items rejected by admin');
        } else {
            salesRequest.status = 'approved';
            salesRequest.approvedBy = user._id;
            salesRequest.approvedByName = safeUserName(user);
            salesRequest.approvedAt = new Date();
        }

        const totals = computeTotals({
            items: normalized.items,
            discount: req.body?.discount ?? salesRequest.discount,
            freight: req.body?.freight ?? salesRequest.freight,
            cgstPercent: req.body?.cgstPercent ?? salesRequest.cgstPercent,
            sgstPercent: req.body?.sgstPercent ?? salesRequest.sgstPercent
        });
        applyTotals(salesRequest, totals);

        if (salesRequest.status === 'approved' && !salesRequest.invoice?.number) {
            salesRequest.invoice = salesRequest.invoice || {};
            salesRequest.invoice.number = await generateInvoiceNumber();
        }

        await salesRequest.save();

        if (salesRequest.status === 'approved') {
            await upsertApprovalLog(salesRequest, user, 'approved');
        } else if (salesRequest.status === 'rejected') {
            await upsertApprovalLog(salesRequest, user, 'rejected');
        }

        const populatedSalesRequest = await salesRequestDetailPopulate(SalesRequest.findById(id));
        return res.json({ success: true, data: populatedSalesRequest });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.rejectRequest = async (req, res) => {
    try {
        const user = req.user;
        if (!canApproveSalesRequest(user.role)) {
            return res.status(403).json({ success: false, message: 'Only admin/company owner can reject requests' });
        }

        const { id } = req.params;
        const { reason } = req.body || {};

        const salesRequest = await SalesRequest.findById(id);
        if (!salesRequest) {
            return res.status(404).json({ success: false, message: 'Sales request not found' });
        }

        if (!assertCompanyAccess(user, salesRequest.companyId)) {
            return res.status(403).json({ success: false, message: 'Sales request access denied' });
        }

        if (salesRequest.status !== 'pending_approval') {
            return res.status(400).json({ success: false, message: 'Only pending approval requests can be rejected' });
        }

        salesRequest.status = 'rejected';
        salesRequest.rejectedBy = user._id;
        salesRequest.rejectedByName = safeUserName(user);
        salesRequest.rejectedAt = new Date();
        salesRequest.rejectionReason = toTrimmed(reason || 'Rejected by admin');

        await salesRequest.save();
        await upsertApprovalLog(salesRequest, user, 'rejected');

        const populatedSalesRequest = await salesRequestDetailPopulate(SalesRequest.findById(id));
        return res.json({ success: true, data: populatedSalesRequest });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.generateInvoicePdf = async (req, res) => {
    try {
        const user = req.user;
        const { id } = req.params;
        const { fileName } = req.body || {};

        const salesRequest = await SalesRequest.findById(id);
        if (!salesRequest) {
            return res.status(404).json({ success: false, message: 'Sales request not found' });
        }

        if (!assertCompanyAccess(user, salesRequest.companyId)) {
            return res.status(403).json({ success: false, message: 'Sales request access denied' });
        }

        if (salesRequest.status !== 'approved') {
            return res.status(400).json({ success: false, message: 'Invoice can only be generated for approved requests' });
        }

        const company = await Company.findById(salesRequest.companyId);
        if (!salesRequest.invoice?.number) {
            salesRequest.invoice = salesRequest.invoice || {};
            salesRequest.invoice.number = await generateInvoiceNumber();
        }
        const buffer = await generateInvoicePdfBuffer({ salesRequest, company });

        salesRequest.invoice = salesRequest.invoice || {};
        salesRequest.invoice.pdfBase64 = buffer.toString('base64');
        salesRequest.invoice.fileName = toTrimmed(fileName || `invoice-${salesRequest.invoice.number || salesRequest.salesRequestId}.pdf`);
        salesRequest.invoice.generatedAt = new Date();
        salesRequest.invoice.generatedBy = user._id;

        await salesRequest.save();
        return res.json({ success: true, data: salesRequest });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getSalesSummaryCards = async (req, res) => {
    try {
        const user = req.user;
        const scope = buildListScope(user);
        if (scope.error) {
            return res.status(scope.error.code).json({ success: false, message: scope.error.message });
        }

        const query = { ...scope.query };
        if (req.query.warehouseId) {
            const warehouseId = String(req.query.warehouseId).trim();
            if (!mongoose.isValidObjectId(warehouseId)) {
                return res.status(400).json({ success: false, message: 'Invalid warehouseId' });
            }
            if (user.role === 'warehouse_manager' && scope.allowedWarehouseIds?.length) {
                const hasAccess = scope.allowedWarehouseIds.some((id) => String(id) === warehouseId);
                if (!hasAccess) {
                    return res.status(403).json({ success: false, message: 'Warehouse access denied' });
                }
            }
            const warehouse = await getWarehouseForUser(warehouseId, user);
            if (!warehouse) {
                return res.status(403).json({ success: false, message: 'Warehouse access denied' });
            }
            query.warehouseId = warehouse._id;
        }
        const now = new Date();
        const { period, startDate, endDate } = req.query || {};

        if (period === 'today') {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            query.createdAt = { $gte: start };
        } else if (period === 'weekly') {
            const start = new Date(now);
            start.setDate(start.getDate() - 7);
            query.createdAt = { $gte: start };
        } else if (period === 'monthly') {
            const start = new Date(now);
            start.setMonth(start.getMonth() - 1);
            query.createdAt = { $gte: start };
        } else if (period === 'date' && startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (!Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf())) {
                query.createdAt = { $gte: start, $lte: end };
            }
        }

        const [pendingApprovals, approvedOrders, drafts, totalSales] = await Promise.all([
            SalesRequest.countDocuments({ ...query, status: 'pending_approval' }),
            SalesRequest.countDocuments({ ...query, status: 'approved' }),
            SalesRequest.countDocuments({ ...query, status: 'draft', createdBy: user._id }),
            SalesRequest.aggregate([
                { $match: { ...query, status: 'approved' } },
                { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } }
            ])
        ]);

        const totalSalesValue = totalSales?.[0]?.total || 0;
        const totalSalesCount = totalSales?.[0]?.count || 0;

        return res.json({
            success: true,
            data: {
                pendingApprovals,
                approvedOrders,
                drafts,
                totalSalesValue,
                totalSalesCount
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getRecentSalesRequests = async (req, res) => {
    try {
        const user = req.user;
        const scope = buildListScope(user);
        if (scope.error) {
            return res.status(scope.error.code).json({ success: false, message: scope.error.message });
        }

        const limit = Math.min(MAX_LIMIT, Math.max(1, toNumber(req.query.limit, 5)));
        const query = { ...scope.query };
        if (req.query.warehouseId) {
            const warehouseId = String(req.query.warehouseId).trim();
            if (!mongoose.isValidObjectId(warehouseId)) {
                return res.status(400).json({ success: false, message: 'Invalid warehouseId' });
            }
            if (user.role === 'warehouse_manager' && scope.allowedWarehouseIds?.length) {
                const hasAccess = scope.allowedWarehouseIds.some((id) => String(id) === warehouseId);
                if (!hasAccess) {
                    return res.status(403).json({ success: false, message: 'Warehouse access denied' });
                }
            }
            const warehouse = await getWarehouseForUser(warehouseId, user);
            if (!warehouse) {
                return res.status(403).json({ success: false, message: 'Warehouse access denied' });
            }
            query.warehouseId = warehouse._id;
        }

        const data = await SalesRequest.find(query)
            .populate('warehouseId', 'warehouseName')
            .populate('createdBy', 'fullName firstName lastName username')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
