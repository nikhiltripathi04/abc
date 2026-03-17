const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const { Schema } = mongoose;

/*
|--------------------------------------------------------------------------
| Role Permissions
|--------------------------------------------------------------------------
*/

const ROLE_PERMISSIONS = {
	company_owner: [
		"create_admin",
		"delete_admin",
		"view_company",
		"manage_company"
	],

	admin: [
		"create_supervisor",
		"create_warehouse_manager",
		"create_staff",
		"delete_users",
		"assign_sites",
		"assign_warehouses"
	],

	supervisor: [
	],

	warehouse_manager: [
	],

	staff: [
	
  ]
};

/*
|--------------------------------------------------------------------------
| Role Hierarchy (for security)
|--------------------------------------------------------------------------
*/

const ROLE_HIERARCHY = {
	company_owner: 5,
	admin: 4,
	supervisor: 3,
	warehouse_manager: 3,
	staff: 2
};

/*
|--------------------------------------------------------------------------
| Notification Preferences
|--------------------------------------------------------------------------
*/

const notificationPreferencesSchema = new Schema({
	siteOrderApprovals: { type: Boolean, default: true },
	quantityChangeApprovals: { type: Boolean, default: true },
	salesInvoiceApprovals: { type: Boolean, default: true },

	reminderAfterHours: { type: Number, default: 24 },

	inApp: { type: Boolean, default: true },
	push: { type: Boolean, default: true },
	webPush: { type: Boolean, default: true },
	email: { type: Boolean, default: false }

}, { _id: false });

/*
|--------------------------------------------------------------------------
| User Schema
|--------------------------------------------------------------------------
*/

const userSchema = new Schema({

	username: {
		type: String,
		required: true,
		unique: true,
		trim: true,
		lowercase: true,
		index: true
	},

	password: {
		type: String,
		required: true,
		select: false
	},

	firstName: {
		type: String,
		required: true,
		trim: true
	},

	lastName: {
		type: String,
		required: true,
		trim: true
	},

	email: {
		type: String,
		unique: true,
		sparse: true,
		trim: true,
		lowercase: true,
		required() {
			return ["admin", "company_owner"].includes(this.role);
		}
	},

	phoneNumber: {
		type: String,
		required() {
			return ["admin", "company_owner"].includes(this.role);
		}
	},

	firmName: {
		type: String,
		trim: true
	},

	jobTitle: {
		type: String,
		required() {
			return this.role === "company_owner";
		}
	},

	role: {
		type: String,
		enum: [
			"company_owner",
			"admin",
			"supervisor",
			"warehouse_manager",
			"staff"
		],
		required: true,
		index: true
	},

	permissions: {
		type: [String],
		default: function () {
			return ROLE_PERMISSIONS[this.role] || [];
		}
	},

	company: {
		type: Schema.Types.ObjectId,
		ref: "Company",
		required() {
			return this.role !== "company_owner";
		},
		index: true
	},

	createdBy: {
		type: Schema.Types.ObjectId,
		ref: "User"
	},

	updatedBy: {
		type: Schema.Types.ObjectId,
		ref: "User"
	},

	sites: [{
		type: Schema.Types.ObjectId,
		ref: "Site"
	}],

	warehouses: [{
		type: Schema.Types.ObjectId,
		ref: "Warehouse"
	}],

	expoPushToken: {
		type: String,
		default: null
	},

	fcmWebTokens: {
		type: [String],
		default: [],
		set: v => [...new Set(v)] // remove duplicates
	},

	pendingApprovalsCount: {
		type: Number,
		default: 0,
		min: 0
	},

	lastApprovalCheckTime: {
		type: Date
	},

	notificationPreferences: {
		type: notificationPreferencesSchema,
		default: () => ({})
	},

	// Soft delete
	isActive: {
		type: Boolean,
		default: true,
		index: true
	}

},
{
	timestamps: true
});

/*
|--------------------------------------------------------------------------
| Indexes (performance)
|--------------------------------------------------------------------------
*/

userSchema.index({ company: 1, role: 1 });
userSchema.index({ username: 1, company: 1 });

/*
|--------------------------------------------------------------------------
| Virtual Fields
|--------------------------------------------------------------------------
*/

userSchema.virtual("fullName").get(function () {
	return `${this.firstName} ${this.lastName}`;
});

/*
|--------------------------------------------------------------------------
| Middleware
|--------------------------------------------------------------------------
*/

// Hash password
userSchema.pre("save", async function (next) {
	if (!this.isModified("password")) return next();

	try {
		const salt = await bcrypt.genSalt(10);
		this.password = await bcrypt.hash(this.password, salt);
		next();
	} catch (error) {
		next(error);
	}
});

// Sync permissions when role changes
userSchema.pre("save", function (next) {
	if (this.isModified("role")) {
		this.permissions = ROLE_PERMISSIONS[this.role] || [];
	}
	next();
});

/*
|--------------------------------------------------------------------------
| Methods
|--------------------------------------------------------------------------
*/

// Password check
userSchema.methods.comparePassword = async function (candidatePassword) {
	return bcrypt.compare(candidatePassword, this.password);
};

// Permission check
userSchema.methods.hasPermission = function (permission) {
	return this.permissions.includes(permission);
};

// Multiple permission check
userSchema.methods.hasAnyPermission = function (permissions = []) {
	return permissions.some(p => this.permissions.includes(p));
};

// Role hierarchy check
userSchema.methods.canCreateRole = function (targetRole) {
	return ROLE_HIERARCHY[this.role] > ROLE_HIERARCHY[targetRole];
};

/*
|--------------------------------------------------------------------------
| Export
|--------------------------------------------------------------------------
*/

module.exports = mongoose.model("User", userSchema);