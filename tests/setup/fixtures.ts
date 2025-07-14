// Test data fixtures for consistent testing

export const testUsers = [
  {
    email: 'admin@example.com',
    name: 'Admin User',
    age: 35,
    is_active: true,
    metadata: { role: 'admin', permissions: ['read', 'write', 'delete'] },
    tags: ['admin', 'staff']
  },
  {
    email: 'user@example.com',
    name: 'Regular User',
    age: 28,
    is_active: true,
    metadata: { role: 'user', preferences: { theme: 'dark' } },
    tags: ['user']
  },
  {
    email: 'inactive@example.com',
    name: 'Inactive User',
    age: 45,
    is_active: false,
    metadata: { role: 'user', deactivated_at: '2023-01-01' },
    tags: ['user', 'inactive']
  }
];

export const testProducts = [
  {
    name: 'Premium Laptop',
    description: 'High-end laptop for professionals',
    price: 1999.99,
    in_stock: true,
    category: 'Electronics',
    tags: ['laptop', 'computer', 'premium'],
    attributes: {
      brand: 'TechCorp',
      model: 'Pro X1',
      specs: {
        cpu: 'Intel i7',
        ram: '16GB',
        storage: '512GB SSD'
      },
      warranty: '3 years'
    }
  },
  {
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse',
    price: 49.99,
    in_stock: true,
    category: 'Electronics',
    tags: ['mouse', 'wireless', 'accessory'],
    attributes: {
      brand: 'TechCorp',
      connectivity: 'Bluetooth',
      battery_life: '6 months',
      color: 'black'
    }
  },
  {
    name: 'Office Chair',
    description: 'Comfortable ergonomic office chair',
    price: 299.99,
    in_stock: false,
    category: 'Furniture',
    tags: ['chair', 'office', 'ergonomic'],
    attributes: {
      brand: 'ComfortSeating',
      material: 'mesh',
      adjustable_height: true,
      weight_capacity: '250 lbs'
    }
  }
];

export const testOrders = [
  {
    // Will be linked to users and products by ID during insertion
    quantity: 1,
    unit_price: 1999.99,
    status: 'completed',
    notes: 'Express shipping requested'
  },
  {
    quantity: 2,
    unit_price: 49.99,
    status: 'pending',
    notes: 'Standard shipping'
  },
  {
    quantity: 1,
    unit_price: 299.99,
    status: 'cancelled',
    notes: 'Item out of stock'
  }
];

// Edge case test data
export const edgeCaseData = {
  users: [
    {
      email: 'unicode@测试.com',
      name: 'Unicode Test 测试用户',
      age: null,
      is_active: true,
      metadata: { 
        special_chars: "!@#$%^&*()",
        unicode: "こんにちは世界",
        emoji: "🚀💻🎉"
      },
      tags: ['unicode', 'special-chars', '测试']
    },
    {
      email: 'empty@example.com',
      name: '',
      age: 0,
      is_active: false,
      metadata: {},
      tags: []
    }
  ],
  
  products: [
    {
      name: 'Product with "quotes" and \'apostrophes\'',
      description: 'Test description with\nnewlines\nand\ttabs',
      price: 0.01,
      in_stock: true,
      category: 'Test & Special',
      tags: ['special-chars', 'quotes', 'test'],
      attributes: {
        sql_injection: "'; DROP TABLE products; --",
        nested: {
          deep: {
            value: "deeply nested"
          }
        }
      }
    }
  ]
};

// Large dataset for performance testing
export function generateLargeDataset(count: number) {
  const users = [];
  const products = [];
  
  for (let i = 0; i < count; i++) {
    users.push({
      email: `user${i}@example.com`,
      name: `User ${i}`,
      age: 20 + (i % 50),
      is_active: i % 3 !== 0,
      metadata: { batch: Math.floor(i / 100), index: i },
      tags: [`batch-${Math.floor(i / 100)}`, `user-${i}`]
    });
    
    products.push({
      name: `Product ${i}`,
      description: `Description for product ${i}`,
      price: 10 + (i * 1.5),
      in_stock: i % 4 !== 0,
      category: `Category ${i % 10}`,
      tags: [`cat-${i % 10}`, `product-${i}`],
      attributes: { 
        batch: Math.floor(i / 100), 
        index: i,
        features: Array.from({ length: i % 5 + 1 }, (_, j) => `feature-${j}`)
      }
    });
  }
  
  return { users, products };
}

// Test schema variations
export const testSchemas = {
  simpleTable: `
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    value INTEGER
  `,
  
  complexTable: `
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    age INTEGER CHECK (age >= 0 AND age <= 150),
    salary DECIMAL(10,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB,
    tags TEXT[],
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
  `,
  
  relationshipTable: `
    parent_id INTEGER NOT NULL,
    child_id INTEGER NOT NULL,
    relationship_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (parent_id, child_id),
    FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (child_id) REFERENCES users(id) ON DELETE CASCADE
  `
};

// Invalid data for error testing
export const invalidData = {
  users: [
    {
      email: 'invalid-email',
      name: 'Test User',
      age: -5, // Invalid age
      is_active: 'not-boolean', // Invalid type
    },
    {
      email: null, // Required field missing
      name: 'Test User',
      age: 25,
    },
    {
      // Duplicate email (would violate unique constraint)
      email: 'admin@example.com',
      name: 'Duplicate Email User',
      age: 30,
    }
  ],
  
  products: [
    {
      name: null, // Required field
      price: 'not-a-number', // Invalid type
      in_stock: 'maybe', // Invalid boolean
    }
  ]
};

// SQL injection test payloads
export const sqlInjectionPayloads = [
  "'; DROP TABLE users; --",
  "' OR '1'='1",
  "'; DELETE FROM users WHERE '1'='1'; --",
  "' UNION SELECT * FROM users --",
  "'; INSERT INTO users (email) VALUES ('hacked'); --",
  "' OR 1=1; --",
  "admin'--",
  "admin'/*",
  "' OR 'x'='x",
  "') OR ('1'='1",
  "1'; EXEC xp_cmdshell('dir'); --",
  "1' AND SLEEP(5); --",
  "'; WAITFOR DELAY '00:00:05'; --"
];