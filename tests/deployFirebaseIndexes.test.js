const fs = require('fs');
const path = require('path');
const {
  parseDeployArgs,
  compareFirestoreSpecs,
  formatComparison,
  parseIndexesStdout,
  planIndexDeploy
} = require('../scripts/deploy-firebase-indexes');

describe('parseDeployArgs', () => {
  test('requires --project', () => {
    expect(parseDeployArgs([], { allowApply: true }).error).toBe('Missing --project <id>');
    expect(parseDeployArgs(['--apply'], { allowApply: true }).error).toBe('Missing --project <id>');
    expect(parseDeployArgs(['--project'], { allowApply: true }).error).toBe('Missing --project <id>');
  });

  test('allows staging without deploying', () => {
    expect(parseDeployArgs(['--project', 'epickup-app-staging'], { allowApply: true })).toEqual({
      project: 'epickup-app-staging',
      apply: false,
      confirmProduction: false
    });
  });

  test('refuses production without --confirm-production', () => {
    expect(parseDeployArgs(['--project', 'epickup-app', '--apply'], { allowApply: true }).error)
      .toBe('Refusing project epickup-app without --confirm-production');
  });

  test('allows production when --confirm-production is present', () => {
    expect(parseDeployArgs(
      ['--project', 'epickup-app', '--confirm-production', '--apply'],
      { allowApply: true }
    )).toEqual({
      project: 'epickup-app',
      apply: true,
      confirmProduction: true
    });
  });

  test('refuses any other project id', () => {
    expect(parseDeployArgs(['--project', 'other-project'], { allowApply: true }).error)
      .toBe('Refusing project other-project');
  });

  test('rejects unknown arguments and --apply when it is not allowed', () => {
    expect(parseDeployArgs(['--project', 'epickup-app-staging', '--dry-run'], { allowApply: true }).error)
      .toBe('Unknown argument --dry-run');
    expect(parseDeployArgs(['--project', 'epickup-app-staging', '--apply'], { allowApply: false }).error)
      .toBe('Unknown argument --apply');
  });
});

describe('planIndexDeploy', () => {
  test('dry run lists indexes and apply deploys without --force', () => {
    const dry = planIndexDeploy(['--project', 'epickup-app-staging']);
    expect(dry.apply).toBe(false);
    expect(dry.listCommand).toBe('firebase firestore:indexes --project epickup-app-staging');
    expect(dry.deployCommand).toBe(
      'firebase deploy --only firestore:indexes --project epickup-app-staging --non-interactive'
    );
    expect(dry.deployCommand.includes('--force')).toBe(false);

    const apply = planIndexDeploy(['--project', 'epickup-app-staging', '--apply']);
    expect(apply.apply).toBe(true);
    expect(apply.deployCommand.includes('--force')).toBe(false);
  });
});

describe('compareFirestoreSpecs', () => {
  const fileIndex = {
    collectionGroup: 'bookings',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'customerId', order: 'ASCENDING' },
      { fieldPath: 'idempotencyKey', order: 'ASCENDING' }
    ]
  };
  const remoteIndex = {
    collectionGroup: 'bookings',
    queryScope: 'COLLECTION',
    density: 'SPARSE_ALL',
    fields: [
      { fieldPath: 'customerId', order: 'ASCENDING' },
      { fieldPath: 'idempotencyKey', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' }
    ]
  };

  test('ignores __name__ and density and classifies add, present, and remote-only', () => {
    const comparison = compareFirestoreSpecs(
      {
        indexes: [fileIndex, fileIndex],
        fieldOverrides: [{
          collectionGroup: 'fareQuotes',
          fieldPath: 'expiresAt',
          ttl: true,
          indexes: [
            { order: 'DESCENDING', queryScope: 'COLLECTION' },
            { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' },
            { order: 'ASCENDING', queryScope: 'COLLECTION' }
          ]
        }]
      },
      {
        indexes: [
          remoteIndex,
          {
            collectionGroup: 'bookings',
            queryScope: 'COLLECTION',
            density: 'SPARSE_ALL',
            fields: [
              { fieldPath: 'status', order: 'ASCENDING' },
              { fieldPath: '__name__', order: 'DESCENDING' }
            ]
          }
        ],
        fieldOverrides: [{
          collectionGroup: 'fareQuotes',
          fieldPath: 'expiresAt',
          ttl: true,
          indexes: [
            { order: 'ASCENDING', queryScope: 'COLLECTION' },
            { order: 'DESCENDING', queryScope: 'COLLECTION' },
            { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' }
          ]
        }, {
          collectionGroup: 'bookings',
          fieldPath: 'status',
          ttl: false,
          indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION' }]
        }]
      }
    );

    expect(comparison.indexes.present).toEqual([
      'bookings :: COLLECTION :: customerId ASCENDING | idempotencyKey ASCENDING'
    ]);
    expect(comparison.indexes.toAdd).toEqual([]);
    expect(comparison.indexes.remoteOnly).toEqual([
      'bookings :: COLLECTION :: status ASCENDING'
    ]);
    expect(comparison.fieldOverrides.present).toHaveLength(1);
    expect(comparison.fieldOverrides.toAdd).toEqual([]);
    expect(comparison.fieldOverrides.remoteOnly).toEqual([
      'bookings :: status :: ttl=false :: ASCENDING COLLECTION'
    ]);
    expect(formatComparison(comparison)).toContain('these will NOT be deleted');
  });

  test('parses JSON when the CLI prefixes the payload', () => {
    const parsed = parseIndexesStdout('note\n{"indexes":[],"fieldOverrides":[]}');
    expect(parsed).toEqual({ indexes: [], fieldOverrides: [] });
  });
});

describe('firestore.indexes.json', () => {
  const spec = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'firestore.indexes.json'),
    'utf8'
  ));

  test('keeps one bookings status/driverId/createdAt index and adds the new definitions', () => {
    expect(spec.indexes).toHaveLength(100);
    expect(spec.fieldOverrides).toHaveLength(18);
    const duplicates = spec.indexes.filter((index) =>
      index.collectionGroup === 'bookings'
      && index.fields.map((field) => `${field.fieldPath} ${field.order}`).join(' | ')
        === 'status ASCENDING | driverId ASCENDING | createdAt DESCENDING'
    );
    expect(duplicates).toHaveLength(1);
    expect(spec.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collectionGroup: 'driverAssignments',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'bookingId', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'expiresAt', order: 'ASCENDING' }
        ]
      }),
      expect.objectContaining({
        collectionGroup: 'driverAssignments',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'driverId', order: 'ASCENDING' },
          { fieldPath: 'assignedAt', order: 'ASCENDING' }
        ]
      }),
      expect.objectContaining({
        collectionGroup: 'marketplaceOrders',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'customerId', order: 'ASCENDING' },
          { fieldPath: 'orderStatus', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' }
        ]
      }),
      expect.objectContaining({
        collectionGroup: 'marketplaceOrders',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'orderStatus', order: 'ASCENDING' },
          { fieldPath: 'window.start', order: 'ASCENDING' }
        ]
      }),
      expect.objectContaining({
        collectionGroup: 'marketplaceOrders',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'payment.status', order: 'ASCENDING' },
          { fieldPath: 'payment.balance.dueBy', order: 'ASCENDING' }
        ]
      }),
      expect.objectContaining({
        collectionGroup: 'marketplaceOrders',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'cancellation.paidCheck', order: 'ASCENDING' },
          { fieldPath: 'cancellation.paidCheckAt', order: 'ASCENDING' }
        ]
      }),
      expect.objectContaining({
        collectionGroup: 'marketplaceOrders',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'orderStatus', order: 'ASCENDING' },
          { fieldPath: 'payment.review.openedAt', order: 'ASCENDING' }
        ]
      })
    ]));
    expect(spec.fieldOverrides).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collectionGroup: 'fareQuotes',
        fieldPath: 'expiresAt',
        ttl: true,
        indexes: [
          { order: 'ASCENDING', queryScope: 'COLLECTION' },
          { order: 'DESCENDING', queryScope: 'COLLECTION' },
          { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' }
        ]
      })
    ]));
  });
});
