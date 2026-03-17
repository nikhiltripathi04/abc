# Backend Modular Architecture Refactoring Plan

## 1. Goal Description
The current ConERP backend is structured using a traditional layered architecture (with `routes`, `controllers`, `models`, `utils`, `middleware` separated into different top-level folders). However, several modules (like Auth, Sites, Warehouses) have business logic tightly coupled inside their route files, missing controllers altogether. 
The goal is to transition to a **Modular Architecture** where each domain (module) contains its own `model`, `route`, `controller`, and `service`. This improves scalability, maintainability, code readability, and separation of concerns.

## 2. User Review Required
> [!IMPORTANT]
> **Refactoring Strategy**
> Since this is a massive structural change, it is recommended to refactor **one module at a time**. During the refactoring of a module, we will:
> 1. Extract business logic from the route into a Service layer.
> 2. Move request handling from the route to a Controller.
> 3. Leave the Route file strictly for defining endpoints and applying middleware.
> 4. Move the Model into the module's folder.
> 
> *Do you agree with tackling this incrementally, starting with core modules like `auth` or `users`?*

## 3. Current State vs Proposed State

### Current Structure (Layered)
```
backend/
├── models/         # All models (User, Site, Order, etc.)
├── controllers/    # Some controllers (order, sales, grn, etc.)
├── routes/         # All routes (auth.js, sites.js, has business logic)
├── middleware/     # Shared middleware
├── utils/          # Shared utilities
└── modules/        # Only 'notification' is here currently
```

### Proposed Structure (Modular)
```
backend/
├── modules/
│   ├── auth/
│   │   ├── auth.routes.js
│   │   ├── auth.controller.js
│   │   └── auth.service.js
│   ├── users/
│   │   ├── user.model.js
│   │   ├── user.routes.js
│   │   ├── user.controller.js
│   │   └── user.service.js
│   ├── sites/
│   │   ├── site.model.js
│   │   ├── site.routes.js
│   │   ├── site.controller.js
│   │   └── site.service.js
│   ├── ... (warehouses, grn, orders, sales, etc.)
├── shared/ (or core/)
│   ├── middleware/ # auth, error handlers
│   ├── utils/      # logger, email, etc.
│   └── database/   # mongoose connection
└── server.js       # Main entry point, mounts module routes
```

## 4. Proposed Module Breakdown

We will categorize the existing files into the following autonomous modules. 

#### [NEW] `modules/users`
- **Models**: [User.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/User.js)
- **Routes**: [user.routes.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/user.routes.js), staff routes
- **Controllers**: `user.controller.js`, `staff.controller.js`
- **Services**: `user.service.js`

#### [NEW] `modules/auth`
- **Routes**: [auth.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/auth.js) (currently in [routes/auth.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/auth.js))
- **Controllers**: `auth.controller.js` (needs to be created by extracting from routes)
- **Services**: `auth.service.js` (needs to be created by extracting from routes)

#### [NEW] `modules/company`
- **Models**: [Company.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/Company.js)
- **Routes**: [company.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/company.js)
- **Controllers**: [company.controller.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/controllers/company.controller.js)
- **Services**: `company.service.js`

#### [NEW] `modules/sites`
- **Models**: [Site.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/Site.js), [SiteReturn.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/SiteReturn.js)
- **Routes**: [sites.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/sites.js)
- **Controllers**: `site.controller.js` (extract from [routes/sites.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/sites.js))
- **Services**: `site.service.js`

#### [NEW] `modules/warehouses`
- **Models**: [Warehouse.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/Warehouse.js)
- **Routes**: [warehouses.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/warehouses.js)
- **Controllers**: `warehouse.controller.js` (extract from [routes/warehouses.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/warehouses.js))
- **Services**: `warehouse.service.js`

#### [NEW] `modules/inventory`
- **Models**: [InventoryItem.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/InventoryItem.js)
- **Routes**: [inventory.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/inventory.js)
- **Controllers**: [inventory.controller.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/controllers/inventory.controller.js)
- **Services**: `inventory.service.js`

#### [NEW] `modules/orders`
- **Models**: [Order.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/Order.js), [SupplyRequest.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/SupplyRequest.js), [Backorder.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/Backorder.js)
- **Routes**: [orders.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/orders.js)
- **Controllers**: [order.controller.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/controllers/order.controller.js)
- **Services**: `order.service.js`

#### [NEW] `modules/grn`
- **Models**: [GRN.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/GRN.js)
- **Routes**: [grn.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/grn.js)
- **Controllers**: [grn.controller.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/controllers/grn.controller.js)
- **Services**: `grn.service.js`

#### [NEW] `modules/sales`
- **Models**: [SalesRequest.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/SalesRequest.js)
- **Routes**: [sales.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/sales.js)
- **Controllers**: [sales.controller.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/controllers/sales.controller.js)
- **Services**: `sales.service.js`

#### [NEW] `modules/attendance`
- **Models**: [Attendance.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/Attendance.js)
- **Routes**: [attendance.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/attendance.js)
- **Controllers**: `attendance.controller.js`
- **Services**: `attendance.service.js`

#### [NEW] `modules/messages`
- **Models**: [Message.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/Message.js)
- **Routes**: [messages.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/messages.js)
- **Controllers**: `message.controller.js`
- **Services**: `message.service.js`

#### [NEW] `modules/approvals`
- **Models**: [ApprovalLog.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/ApprovalLog.js), [ItemDetailChangeRequest.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/ItemDetailChangeRequest.js), [QuantityChangeRequest.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/QuantityChangeRequest.js)
- **Routes**: [approvals.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/approvals.js)
- **Controllers**: [approval.controller.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/controllers/approval.controller.js)
- **Services**: `approval.service.js`

#### [NEW] `modules/activity_logs`
- **Models**: [ActivityLog.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/models/ActivityLog.js)
- **Services**: Extract [utils/activityLogger.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/utils/activityLogger.js) into a proper service.

*(The `notification` module is already correctly structured).*

## 5. Unnecessary Code & Clean up
- Several route files (e.g., [routes/sites.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/sites.js) is 2500+ lines, [routes/auth.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/routes/auth.js) is 1000+ lines) are massively bloated because they contain route definitions, request validation, business logic, DB queries, and response formatting all mixed together.
- Once refactored into `Service` and `Controller`, the route files will be slimmed down to 50-100 lines each.
- Unused or duplicated utility functions in `utils/` will be localized to their respective module services if they are not truly shared.

## 6. Implementation Plan (Step-by-Step)
1. **Setup Core/Shared Directory**: Move `middleware`, `utils`, `core`, and `config` to a `shared` folder. Update [server.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/server.js) imports.
2. **Refactor Module by Module**:
   - Create `modules/[featureName]` folder.
   - Move `Model` into it.
   - Create `Service` file: Extract DB queries and core business logic from existing routes/controllers.
   - Create `Controller` file: Extract request parsing, response sending, and HTTP status codes. Call the Service here.
   - Create `Route` file: Import the Controller, apply middleware, and map routes.
   - Update [server.js](file:///Users/nikhiltripathi/Desktop/ConERP-10thFeb/backend/server.js) to point to `modules/[featureName]/[featureName].routes.js`.
3. **Run Tests**: Verify each module's endpoints immediately after refactoring using Postman or existing test scripts.

## 7. Verification Plan
### Automated Tests
- Run existing node scripts in the `scripts/` directory (e.g., `node scripts/test_backend_flow.js`, `node scripts/test_db_connection.js`) after each module transition to ensure nothing broke.

### Manual Verification
1. Start the server locally (`npm run dev` or `node server.js`).
2. Verify fundamental endpoints (Login, Fetch Sites, Fetch Inventory) return 200 OK via curl or standard frontend usage.
3. Ensure Socket.IO and Cron jobs still initialize without errors.