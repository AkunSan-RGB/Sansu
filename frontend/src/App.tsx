import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './auth/LoginPage';
import ApproveLinkPage from './auth/ApproveLinkPage';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './auth/AccountPages';
import BillingPage from './features/billing/BillingPage';
import WarehousesPage from './features/settings/WarehousesPage';
import SecurityPage from './features/settings/SecurityPage';
import HelpCenterPage from './features/help/HelpCenter';
import PlatformAdminPage from './features/platform/PlatformAdminPage';
import AppGate from './auth/AppGate';
import RequireAuth from './auth/RequireAuth';
import LeadsPipelinePage from './features/crm/PipelinePage';
import QuotationDetailPage from './features/crm/QuotationDetailPage';
import QuotationFormPage from './features/crm/QuotationFormPage';
import QuotationsPage from './features/crm/QuotationsPage';
import HomePage from './features/home/HomePage';
import AttendancePage from './features/hr/AttendancePage';
import EmployeesPage from './features/hr/EmployeesPage';
import EmploymentControlPage from './features/hr/EmploymentControlPage';
import LeavesPage from './features/hr/LeavesPage';
import PayrollRunPage from './features/payroll/PayrollRunPage';
import ServiceWorkPage from './features/payroll/ServiceWorkPage';
import PayrollRunsPage from './features/payroll/PayrollRunsPage';
import Pph21ReportPage from './features/payroll/Pph21ReportPage';
import PosPage from './features/pos/PosPage';
import PosSessionsPage from './features/pos/PosSessionsPage';
import StaffSalesPage from './features/pos/StaffSalesPage';
import AppsPage from './features/settings/AppsPage';
import CompanySettingsPage from './features/settings/CompanySettingsPage';
import UsersPage from './features/settings/UsersPage';
import ImportPage from './features/settings/ImportPage';
import AuditPage from './features/settings/AuditPage';
import AccountsPage from './features/accounting/AccountsPage';
import ClosingPage from './features/accounting/ClosingPage';
import LedgerPage from './features/accounting/LedgerPage';
import OpeningBalancePage from './features/accounting/OpeningBalancePage';
import CashPage from './features/cash/CashPage';
import PettyCashPage from './features/cash/PettyCashPage';
import CashCountsPage from './features/cash/CashCountsPage';
import PurchaseInvoicesPage from './features/purchasing/PurchaseInvoicesPage';
import PurchaseOrderDetailPage from './features/purchasing/PurchaseOrderDetailPage';
import PurchaseOrderFormPage from './features/purchasing/PurchaseOrderFormPage';
import SupplierAdvancesPage from './features/purchasing/SupplierAdvancesPage';
import PurchaseOrdersPage from './features/purchasing/PurchaseOrdersPage';
import PurchaseRequestDetailPage from './features/purchasing/PurchaseRequestDetailPage';
import PurchaseRequestFormPage from './features/purchasing/PurchaseRequestFormPage';
import QuickPurchasePage from './features/purchasing/QuickPurchasePage';
import PurchaseRequestsPage from './features/purchasing/PurchaseRequestsPage';
import SuppliersPage from './features/purchasing/SuppliersPage';
import ReturnsPage from './features/returns/ReturnsPage';
import JournalsPage from './features/accounting/JournalsPage';
import ReportsPage from './features/accounting/ReportsPage';
import AdjustmentsPage from './features/accounting/AdjustmentsPage';
import TrialBalancePage from './features/accounting/TrialBalancePage';
import VatPage from './features/accounting/VatPage';
import WorksheetPage from './features/accounting/WorksheetPage';
import FiscalPage from './features/accounting/FiscalPage';
import BankPage from './features/accounting/BankPage';
import TaxPage from './features/accounting/TaxPage';
import TaxRecapPage from './features/accounting/TaxRecapPage';
import { BpjsReport } from './features/accounting/tax-recap/BpjsReport';
import PageHeader from './layout/PageHeader';
import IntegrationsPage from './features/accounting/IntegrationsPage';
import FixedAssetsRedirect from './features/accounting/schedules/FixedAssetsRedirect';
import HealthPage from './features/accounting/HealthPage';
import ForeignCashPage from './features/cash/ForeignCashPage';
import CustomersPage from './features/customers/CustomersPage';
import DashboardPage from './features/dashboard/DashboardPage';
import WorkspacePage from './features/workspace/WorkspacePage';
import InventoryPage from './features/inventory/InventoryPage';
import TransfersPage from './features/inventory/TransfersPage';
import CountsPage, { CountDetailPage } from './features/inventory/CountsPage';
import WarehouseStockPage from './features/inventory/WarehouseStockPage';
import BinsPage from './features/inventory/BinsPage';
import WritedownsPage from './features/inventory/WritedownsPage';
import SalesControlsPage from './features/sales/SalesControlsPage';
import InventoryControlsPage from './features/inventory/InventoryControlsPage';
import PurchaseControlsPage from './features/purchasing/PurchaseControlsPage';
import FinanceControlsPage from './features/cash/FinanceControlsPage';
import AccountingControlsPage from './features/accounting/AccountingControlsPage';
import SupportReportsPage from './features/accounting/SupportReportsPage';
import ShiftRosterPage from './features/hr/ShiftRosterPage';
import ShoppingListPage from './features/purchasing/ShoppingListPage';
import TasksPage from './features/tasks/TasksPage';
import PriceAgreementsPage from './features/purchasing/PriceAgreementsPage';
import UtilityPage from './features/utility/UtilityPage';
import PortalPage from './features/utility/PortalPage';
import BranchesPage from './features/accounting/BranchesPage';
import KitchenPage from './features/pos/KitchenPage';
import OnlineOrdersPage from './features/pos/OnlineOrdersPage';
import LoyaltyPage from './features/pos/LoyaltyPage';
import CardSettlementPage from './features/pos/CardSettlementPage';
import TablesPage from './features/pos/TablesPage';
import ExpiryPage from './features/inventory/ExpiryPage';
import LotTracePage from './features/inventory/LotTracePage';
import PriceListsPage from './features/pricing/PriceListsPage';
import CanvassPage from './features/fmcg/CanvassPage';
import ConsignmentsPage from './features/fmcg/ConsignmentsPage';
import SwapsPage from './features/fmcg/SwapsPage';
import TradePage from './features/fmcg/TradePage';
import PromosPage from './features/pricing/PromosPage';
import SalesTargetsPage from './features/pricing/SalesTargetsPage';
import MovementPage from './features/inventory/MovementPage';
import BomsPage from './features/production/BomsPage';
import WorkCentersPage from './features/production/WorkCentersPage';
import QcPage from './features/production/QcPage';
import MaterialRequirementsPage from './features/production/MaterialRequirementsPage';
import ProductionVariancePage from './features/production/ProductionVariancePage';
import ProductionOrdersPage from './features/production/ProductionOrdersPage';
import ProductionReportPage from './features/production/ProductionReportPage';
import ServiceInvoiceFormPage from './features/services/ServiceInvoiceFormPage';
import ProjectsPage from './features/services/ProjectsPage';
import { ProjectDetailPage } from './features/services/projects/ProjectDetailPage';
import DepositsPage from './features/services/DepositsPage';
import TimesheetPage from './features/services/TimesheetPage';
import SchedulePage from './features/services/SchedulePage';
import RetainersPage from './features/services/RetainersPage';
import EducationPage from './features/services/EducationPage';
import DeptReportPage from './features/laporan/DeptReportPage';
import WithheldPage from './features/services/WithheldPage';
import ProductsPage from './features/products/ProductsPage';
import DocumentViewPage from './features/accounting/DocumentViewPage';
import ApprovalsPage from './features/approvals/ApprovalsPage';
import DeliveriesPage from './features/sales/DeliveriesPage';
import DeliveryTripsPage from './features/sales/DeliveryTripsPage';
import GoodsReceiptDetailPage from './features/purchasing/GoodsReceiptDetailPage';
import GoodsReceiptsPage from './features/purchasing/GoodsReceiptsPage';
import DeliveryDetailPage from './features/sales/DeliveryDetailPage';
import InvoiceDetailPage from './features/sales/InvoiceDetailPage';
import InvoicesPage from './features/sales/InvoicesPage';
import SalesOrderDetailPage from './features/sales/SalesOrderDetailPage';
import SalesOrderFormPage from './features/sales/SalesOrderFormPage';
import SalesOrdersPage from './features/sales/SalesOrdersPage';
import AppLayout from './layout/AppLayout';
import { PrivacyPage, TermsPage } from './auth/LegalPages';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/syarat-layanan" element={<TermsPage />} />
      <Route path="/kebijakan-privasi" element={<PrivacyPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/approve/:token" element={<ApproveLinkPage />} />
      <Route path="/portal/air/:token" element={<PortalPage />} />
      <Route
        path="/pos"
        element={
          <RequireAuth>
            <AppGate app="pos" />
          </RequireAuth>
        }
      >
        <Route index element={<PosPage />} />
      </Route>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route element={<AppGate app={['accounting', 'sales']} />}>
          <Route path="dashboard" element={<DashboardPage />} />
        </Route>
        <Route path="vertikal" element={<WorkspacePage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        {/* tidak di bawah gerbang aplikasi tertentu: dipakai semua peran; hak akses per data dijaga server */}
        <Route path="tasks" element={<TasksPage />} />
        <Route path="laporan/:dept" element={<DeptReportPage />} />
        <Route path="workflow" element={<Navigate to="/tasks?tab=proses" replace />} />
        <Route path="fx" element={<Navigate to="/cash/foreign" replace />} />
        <Route path="documents/:id" element={<DocumentViewPage />} />
        <Route element={<AppGate app="crm" />}>
          <Route path="crm" element={<LeadsPipelinePage />} />
          <Route path="quotations" element={<QuotationsPage />} />
          <Route path="quotations/new" element={<QuotationFormPage />} />
          <Route path="quotations/:id" element={<QuotationDetailPage />} />
        </Route>
        <Route element={<AppGate app="sales" />}>
          <Route path="sales-orders" element={<SalesOrdersPage />} />
          <Route path="sales-orders/new" element={<SalesOrderFormPage />} />
          <Route path="sales-orders/:id" element={<SalesOrderDetailPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="invoices/services/new" element={<ServiceInvoiceFormPage />} />
          <Route path="deliveries" element={<DeliveriesPage />} />
          <Route path="delivery-trips" element={<DeliveryTripsPage />} />
          <Route path="deliveries/:id" element={<DeliveryDetailPage />} />
          <Route path="invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="timesheets" element={<TimesheetPage />} />
          <Route path="scheduling" element={<SchedulePage />} />
          <Route path="retainers" element={<RetainersPage />} />
          <Route path="education" element={<EducationPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="customer-deposits" element={<DepositsPage />} />
          <Route path="tax/withheld" element={<WithheldPage />} />
        </Route>
        <Route element={<AppGate app={['sales', 'crm', 'pos']} />}>
          <Route path="customers" element={<CustomersPage />} />
        </Route>
        <Route element={<AppGate app={['sales', 'purchase']} />}>
          <Route path="returns" element={<ReturnsPage />} />
        </Route>
        <Route element={<AppGate app="pos" />}>
          <Route path="pos/sessions" element={<PosSessionsPage />} />
          <Route path="pos/staff-sales" element={<StaffSalesPage />} />
          <Route path="pos/tables" element={<TablesPage />} />
          <Route path="pos/kitchen" element={<KitchenPage />} />
          <Route path="pos/online" element={<OnlineOrdersPage />} />
          <Route path="pos/loyalty" element={<LoyaltyPage />} />
          <Route path="pos/settlements" element={<CardSettlementPage />} />
        </Route>
        <Route element={<AppGate app="purchase" />}>
          <Route path="goods-receipts" element={<GoodsReceiptsPage />} />
          <Route path="goods-receipts/:id" element={<GoodsReceiptDetailPage />} />
          <Route path="purchase-requests" element={<PurchaseRequestsPage />} />
          <Route path="purchase-requests/new" element={<PurchaseRequestFormPage />} />
          <Route path="purchase-requests/:id" element={<PurchaseRequestDetailPage />} />
          <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
          <Route path="supplier-advances" element={<SupplierAdvancesPage />} />
          <Route path="purchase-orders/new" element={<PurchaseOrderFormPage />} />
          <Route path="purchase-orders/quick" element={<QuickPurchasePage />} />
          <Route path="purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
          <Route path="purchase-invoices" element={<PurchaseInvoicesPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
        </Route>
        <Route element={<AppGate app="inventory" />}>
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inventory/transfers" element={<TransfersPage />} />
          <Route path="inventory/counts" element={<CountsPage />} />
          <Route path="inventory/counts/:id" element={<CountDetailPage />} />
          <Route path="inventory/warehouses" element={<WarehouseStockPage />} />
          <Route path="inventory/bins" element={<BinsPage />} />
          <Route path="inventory/writedowns" element={<WritedownsPage />} />
          <Route path="purchase-controls" element={<PurchaseControlsPage />} />
          <Route path="sales-controls" element={<SalesControlsPage />} />
          <Route path="finance-controls" element={<FinanceControlsPage />} />
          <Route path="accounting-controls" element={<AccountingControlsPage />} />
          <Route path="support-reports" element={<SupportReportsPage />} />
          <Route path="inventory-controls" element={<InventoryControlsPage />} />
          <Route path="shopping-list" element={<ShoppingListPage />} />
          <Route path="shifts" element={<ShiftRosterPage />} />
          <Route path="price-agreements" element={<PriceAgreementsPage />} />
          <Route path="utility/:tab?" element={<UtilityPage />} />
          <Route path="settings/branches" element={<BranchesPage />} />
          <Route path="branches" element={<Navigate to="/reports?tab=branches" replace />} />
          <Route path="inventory/movement" element={<MovementPage />} />
          <Route path="inventory/expiry" element={<ExpiryPage />} />
          <Route path="inventory/lot-trace" element={<LotTracePage />} />
          <Route path="price-lists" element={<PriceListsPage />} />
          <Route path="promos" element={<PromosPage />} />
          <Route path="consignments" element={<ConsignmentsPage />} />
          <Route path="goods-swaps" element={<SwapsPage />} />
          <Route path="canvass" element={<CanvassPage />} />
          <Route path="trade" element={<TradePage />} />
          <Route path="sales-targets" element={<SalesTargetsPage />} />
          <Route path="production/boms" element={<BomsPage />} />
          <Route path="production/orders" element={<ProductionOrdersPage />} />
          <Route path="production/work-centers" element={<WorkCentersPage />} />
          <Route path="production/qc" element={<QcPage />} />
          <Route path="production/report" element={<ProductionReportPage />} />
          <Route path="production/requirements" element={<MaterialRequirementsPage />} />
          <Route path="production/variance" element={<ProductionVariancePage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="warehouses" element={<WarehousesPage />} />
        </Route>
        <Route element={<AppGate app="cash" />}>
          <Route path="cash" element={<CashPage />} />
          <Route path="petty-cash" element={<PettyCashPage />} />
          <Route path="cash/counts" element={<CashCountsPage />} />
          <Route path="cash/foreign" element={<ForeignCashPage />} />
        </Route>
        <Route element={<AppGate app="accounting" />}>
          <Route path="journals" element={<JournalsPage />} />
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="opening-balance" element={<OpeningBalancePage />} />
          <Route path="closing" element={<ClosingPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="adjustments" element={<AdjustmentsPage />} />
          <Route path="trial-balance" element={<TrialBalancePage />} />
          <Route path="worksheet" element={<WorksheetPage />} />
          <Route path="vat" element={<VatPage />} />
          <Route path="health" element={<HealthPage />} />
          <Route path="account-schedules" element={<FixedAssetsRedirect />} />
          <Route path="fixed-assets" element={<FixedAssetsRedirect />} />
          <Route path="fiscal" element={<FiscalPage />} />
          <Route path="bank" element={<BankPage />} />
          <Route path="tax" element={<TaxPage />} />
          <Route path="tax/recap" element={<TaxRecapPage />} />
        </Route>
        <Route element={<AppGate app={['sales', 'accounting']} />}>
          <Route path="integrations" element={<IntegrationsPage />} />
        </Route>
        <Route element={<AppGate app="hr" />}>
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="employees/controls" element={<EmploymentControlPage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="leaves" element={<LeavesPage />} />
        </Route>
        <Route element={<AppGate app="payroll" />}>
          <Route path="payroll" element={<PayrollRunsPage />} />
          <Route path="payroll/pph21" element={<Pph21ReportPage />} />
          <Route path="payroll/jasa" element={<ServiceWorkPage />} />
          <Route
            path="payroll/bpjs"
            element={
              <>
                <PageHeader title="Rekap iuran BPJS" />
                <BpjsReport />
              </>
            }
          />
          <Route path="payroll/:id" element={<PayrollRunPage />} />
        </Route>
        <Route element={<AppGate admin />}>
          <Route path="settings/apps" element={<AppsPage />} />
          <Route path="settings/users" element={<UsersPage />} />
          <Route path="settings/company" element={<CompanySettingsPage />} />
          <Route path="settings/import" element={<ImportPage />} />
          <Route path="settings/audit" element={<AuditPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings/warehouses" element={<Navigate to="/warehouses" replace />} />
        </Route>
        <Route path="platform" element={<PlatformAdminPage />} />
        <Route path="account/security" element={<SecurityPage />} />
        <Route path="help" element={<HelpCenterPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
