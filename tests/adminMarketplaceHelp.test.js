const supportTickets = [];

const mockDb = {
  collection(name) {
    if (name !== 'supportTickets') {
      throw new Error(`Unexpected collection ${name}`);
    }
    return {
      where(field, op, value) {
        const filtered = supportTickets.filter((row) => row[field] === value);
        return {
          where(field2, op2, value2) {
            const twice = filtered.filter((row) => row[field2] === value2);
            return {
              orderBy() {
                return {
                  limit(n) {
                    return {
                      async get() {
                        return {
                          docs: twice.slice(0, n).map((row) => ({
                            id: row.id,
                            data: () => {
                              const { id, ...rest } = row;
                              return rest;
                            }
                          }))
                        };
                      }
                    };
                  }
                };
              }
            };
          },
          orderBy() {
            return {
              limit(n) {
                return {
                  async get() {
                    return {
                      docs: filtered.slice(0, n).map((row) => ({
                        id: row.id,
                        data: () => {
                          const { id, ...rest } = row;
                          return rest;
                        }
                      }))
                    };
                  }
                };
              }
            };
          }
        };
      },
      doc(id) {
        return {
          async get() {
            const row = supportTickets.find((t) => t.id === id);
            if (!row) {
              return { exists: false };
            }
            const { id: _id, ...data } = row;
            return { exists: true, data: () => data };
          }
        };
      }
    };
  }
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockDb)
}));

jest.mock('../src/services/shopOrderService', () => ({
  supportCancelBeforeHandover: jest.fn(),
  resolveReview: jest.fn()
}));

jest.mock('firebase-admin', () => {
  const blockRealFirestore = () => {
    throw new Error('REAL FIRESTORE IN TEST');
  };
  return {
    apps: [],
    initializeApp: jest.fn(blockRealFirestore),
    app: jest.fn(blockRealFirestore),
    credential: { cert: jest.fn() },
    firestore: blockRealFirestore
  };
});

const adminMarketplaceService = require('../src/services/admin/adminMarketplaceService');

describe('adminMarketplaceService help tickets', () => {
  beforeEach(() => {
    supportTickets.length = 0;
    jest.clearAllMocks();
  });

  test('listHelpTickets queries category marketplace_order', async () => {
    supportTickets.push(
      {
        id: 'wrong',
        category: 'marketplace',
        status: 'open',
        createdAt: new Date('2025-01-02')
      },
      {
        id: 'right',
        category: 'marketplace_order',
        status: 'open',
        createdAt: new Date('2025-01-03')
      }
    );

    const result = await adminMarketplaceService.listHelpTickets({ limit: 10, offset: 0 });
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0].id).toBe('right');
  });

  test('getHelpTicket rejects non marketplace_order category', async () => {
    supportTickets.push({
      id: 'parcel-ticket',
      category: 'general',
      status: 'open'
    });

    await expect(adminMarketplaceService.getHelpTicket('parcel-ticket')).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
      status: 404
    });
  });
});
