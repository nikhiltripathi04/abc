const request = require('supertest');
const { expect } = require('chai');

const BASE = process.env.BASE_URL || 'http://localhost:3000';

describe('Auth & user flows (integration)', function () {
	this.timeout(20000);

	const unique = Date.now();
	const adminCreds = {
		username: `testadmin_${unique}`,
		password: 'Pass1234!',
		email: `testadmin_${unique}@example.com`,
		phoneNumber: '1234567890',
		firmName: 'TestFirm',
		jobTitle: 'Owner',
	};

	let loggedUser = null;
	let createdAdmin = null;
	let createdAdminId = null;

	it('registers a company owner via /api/auth/register', async () => {
		const res = await request(BASE).post('/api/auth/register').send(adminCreds);
		console.log('REGISTER RESPONSE:', res.status, JSON.stringify(res.body));
		expect(res.status).to.equal(201);
		expect(res.body).to.have.property('success', true);
	});

	it('logs in the company owner via /api/auth/login', async () => {
		const res = await request(BASE).post('/api/auth/login').send({ username: adminCreds.username, password: adminCreds.password });
		console.log('LOGIN RESPONSE:', res.status, JSON.stringify(res.body));
		expect(res.status).to.equal(200);
		expect(res.body).to.have.property('accessToken');
		expect(res.body).to.have.property('user');
		loggedUser = res.body.user;
	});

	it('creates an admin using company_owner id (create-admin)', async () => {
		const adminPayload = { username: `admin_${unique}`, password: 'Pass1234!', email: `admin_${unique}@example.com`, authAdminId: loggedUser.id };
		const res = await request(BASE).post('/api/auth/create-admin').send(adminPayload);
		console.log('CREATE-ADMIN RESPONSE:', res.status, JSON.stringify(res.body));
		expect(res.status).to.equal(201);
		expect(res.body).to.have.property('success', true);
		createdAdmin = res.body.data;
		console.log('CREATED ADMIN:', JSON.stringify(createdAdmin));
		createdAdminId = createdAdmin.id || createdAdmin._id;
		expect(createdAdminId).to.exist;
	});

	it('creates a supervisor using adminId', async () => {
		const payload = { username: `sup_${unique}`, password: 'Pass1234!', adminId: createdAdminId, fullName: 'Supervisor One' };
		const res = await request(BASE).post('/api/auth/create-supervisor').send(payload);
		console.log('CREATE-SUPERVISOR RESPONSE:', res.status, JSON.stringify(res.body));
		expect([200,201]).to.include(res.status);
		expect(res.body).to.have.property('success', true);
	});

	it('creates a warehouse manager using adminId', async () => {
		const payload = { username: `wm_${unique}`, password: 'Pass1234!', adminId: createdAdminId, fullName: 'Warehouse Manager' };
		const res = await request(BASE).post('/api/auth/create-warehouse-manager').send(payload);
		console.log('CREATE-WM RESPONSE:', res.status, JSON.stringify(res.body));
		expect([200,201]).to.include(res.status);
		expect(res.body).to.have.property('success', true);
	});

	// Note: There is no public create-staff endpoint in the current codebase. If you want staff creation automated,
	// we can add an endpoint similar to createSupervisor/createWarehouseManager that requires an adminId.
});
