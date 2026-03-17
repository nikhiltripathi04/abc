const request = require('supertest');
const { expect } = require('chai');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_32_characters';

let app;
let mongoServer;

before(async function () {
	this.timeout(30000);
	mongoServer = await MongoMemoryServer.create();
	process.env.MONGODB_URI = mongoServer.getUri();

	const connectDB = require('../config/db');
	await connectDB();

	({ app } = require('../server'));
});

after(async () => {
	await mongoose.connection.close();
	if (mongoServer) {
		await mongoServer.stop();
	}
});

describe('Auth & user flows (integration)', function () {
	this.timeout(20000);

	const unique = Date.now();
	const adminCreds = {
		username: `testadmin_${unique}`,
		password: 'Pass1234!',
		email: `testadmin_${unique}@example.com`,
		phoneNumber: '1234567890',
		firstName: 'Test',
		lastName: 'Owner',
		jobTitle: 'Owner',
	};

	let loggedUser = null;
	let ownerAccessToken = null;
	let createdAdmin = null;
	let createdAdminId = null;
	let adminAccessToken = null;

	it('registers a company owner via /api/auth/register', async () => {
		const res = await request(app).post('/api/auth/register').send(adminCreds);
		console.log('REGISTER RESPONSE:', res.status, JSON.stringify(res.body));
		expect(res.status).to.equal(201);
		expect(res.body).to.have.property('success', true);
	});

	it('logs in the company owner via /api/auth/login', async () => {
		const res = await request(app).post('/api/auth/login').send({ username: adminCreds.username, password: adminCreds.password });
		console.log('LOGIN RESPONSE:', res.status, JSON.stringify(res.body));
		expect(res.status).to.equal(200);
		expect(res.body).to.have.property('accessToken');
		expect(res.body).to.have.property('user');
		ownerAccessToken = res.body.accessToken;
		loggedUser = res.body.user;
	});

	it('creates an admin using company_owner id (create-admin)', async () => {
		const adminPayload = {
			username: `admin_${unique}`,
			password: 'Pass1234!',
			email: `admin_${unique}@example.com`,
			firstName: 'Admin',
			lastName: 'User',
		};
		const res = await request(app)
			.post('/api/company/create-admin')
			.set('Authorization', `Bearer ${ownerAccessToken}`)
			.send(adminPayload);
		console.log('CREATE-ADMIN RESPONSE:', res.status, JSON.stringify(res.body));
		expect(res.status).to.equal(201);
		expect(res.body).to.have.property('success', true);
		createdAdmin = res.body.data;
		console.log('CREATED ADMIN:', JSON.stringify(createdAdmin));
		createdAdminId = createdAdmin.id || createdAdmin._id;
		expect(createdAdminId).to.exist;
	});

	it('creates a supervisor using adminId', async () => {
		const loginAdminRes = await request(app)
			.post('/api/auth/login')
			.send({ username: createdAdmin.username, password: 'Pass1234!' });
		expect(loginAdminRes.status).to.equal(200);
		adminAccessToken = loginAdminRes.body.accessToken;

		const payload = {
			username: `sup_${unique}`,
			password: 'Pass1234!',
			firstName: 'Supervisor',
			lastName: 'One',
		};
		const res = await request(app)
			.post('/api/auth/create-supervisor')
			.set('Authorization', `Bearer ${adminAccessToken}`)
			.send(payload);
		console.log('CREATE-SUPERVISOR RESPONSE:', res.status, JSON.stringify(res.body));
		expect([200,201]).to.include(res.status);
		expect(res.body).to.have.property('success', true);
	});

	it('creates a warehouse manager using adminId', async () => {
		const payload = {
			username: `wm_${unique}`,
			password: 'Pass1234!',
			firstName: 'Warehouse',
			lastName: 'Manager',
		};
		const res = await request(app)
			.post('/api/auth/create-warehouse-manager')
			.set('Authorization', `Bearer ${adminAccessToken}`)
			.send(payload);
		console.log('CREATE-WM RESPONSE:', res.status, JSON.stringify(res.body));
		expect([200,201]).to.include(res.status);
		expect(res.body).to.have.property('success', true);
	});

	// Note: There is no public create-staff endpoint in the current codebase. If you want staff creation automated,
	// we can add an endpoint similar to createSupervisor/createWarehouseManager that requires an adminId.
});
