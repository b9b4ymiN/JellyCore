# รายงานปัญหา: Graph API ไม่บันทึกข้อมูล

**วันที่:** 14 มีนาคม 2026
**ผู้รายงาน:** โจ (AI Developer Engineer)
**ความรุนแรง:** สูง
**สถานะ:** รอดำเนินการ

---

## 1. ปัญหาที่พบ

### อาการ
เมื่อเรียกใช้ Graph API เพื่อสร้างความสัมพันธ์ระหว่าง concepts ระบบแจ้งว่าสำเร็จ แต่ข้อมูลไม่ถูกบันทึกลงฐานข้อมูล

### การทดสอบ
```
POST /api/graph/discover
→ {"message":"Relationship discovery complete","processed":703,"relationships":12952"}

GET /api/graph/stats
→ {"stats":{"totalRelationships":0,"totalConcepts":0,"byType":{},"avgStrength":0}}
```

### ผลกระทบ
- ฟีเจอร์ Knowledge Graph ใช้งานไม่ได้
- การค้นหา concepts ที่เกี่ยวข้องไม่ทำงาน
- การวิเคราะห์ความสัมพันธ์ระหว่างข้อมูลไม่สามารถทำได้

---

## 2. การวิเคราะห์สาเหตุ

### สาเหตุหลัก: Table ขาดจาก Runtime Schema

ระบบมีการกำหนด table อยู่ 2 ที่:

| ที่มา | สถานะ | หน้าที่ |
|-------|-------|---------|
| `src/db/schema.ts` | ✅ มี | Drizzle ORM schema |
| `scripts/migrate-p4-graph.ts` | ✅ มี | Manual migration |
| `src/db/runtime-schema.ts` | ❌ ไม่มี | Auto-create on startup |

**ผลลัพธ์:** เมื่อ server start จะเรียก `ensureSchema()` ซึ่งสร้าง table จาก `runtime-schema.ts` ทำให้ table `concept_relationships` ไม่ถูกสร้าง

### สาเหตุรอง: Silent Error Handling

ไฟล์ `src/knowledge-graph-service.ts` จัดการ error แบบเงียบ:

```typescript
} catch (error) {
  logNonFatal('graph.record_relationship', error, { rel });
  // Error ถูก log แต่ไม่ throw ต่อ
}
```

ทำให้:
- INSERT ล้มเหลวแต่โปรแกรมทำงานต่อ
- ระบบแจ้ง success แม้ข้อมูลไม่ถูกบันทึก
- ผู้ใช้ไม่รู้ว่าเกิดปัญหา

---

## 3. การไหลของข้อมูล (Data Flow)

```
[Server Start]
     │
     ▼
[ensureSchema()] ──→ สร้าง tables จาก runtime-schema.ts
     │                    │
     │                    └── ❌ concept_relationships ไม่ถูกสร้าง
     ▼
[API: POST /discover]
     │
     ▼
[discoverRelationships()]
     │
     ▼
[recordRelationship()] ──→ INSERT INTO concept_relationships
     │                              │
     │                              └── ❌ Table ไม่มี = Error
     ▼
[logNonFatal()] ──→ Log เป็น warning (ไม่ throw)
     │
     ▼
[Return Success] ──→ ❌ แจ้ง 12,952 relationships ทั้งที่ fail
```

---

## 4. วิธีแก้ไข

### ขั้นตอนที่ 1: เพิ่ม Table ใน Runtime Schema

ไฟล์: `src/db/runtime-schema.ts`
ตำแหน่ง: หลังบรรทัด 203 (หลัง table `trace_log`)

```typescript
  // Concept Relationships - Knowledge Graph
  database.exec(`
    CREATE TABLE IF NOT EXISTS concept_relationships (
      id TEXT PRIMARY KEY,
      from_concept TEXT NOT NULL,
      to_concept TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      strength INTEGER DEFAULT 1,
      last_seen INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      metadata TEXT
    )
  `);

  database.exec('CREATE INDEX IF NOT EXISTS idx_rel_from ON concept_relationships(from_concept)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_rel_to ON concept_relationships(to_concept)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_rel_type ON concept_relationships(relationship_type)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_rel_strength ON concept_relationships(strength)');
```

### ขั้นตอนที่ 2: Build & Deploy

```bash
cd /path/to/oracle-v2
bun run build
systemctl restart oracle-v2  # หรือวิธี restart ที่ใช้
```

### ขั้นตอนที่ 3: ทดสอบ

```bash
# Run discovery
curl -X POST http://161.118.205.103:47778/api/graph/discover

# Verify
curl http://161.118.205.103:47778/api/graph/stats
# คาดว่าจะได้: {"stats":{"totalRelationships":12952,...}}
```

---

## 5. แนวทางป้องกันปัญหาซ้ำ

### 5.1 เพิ่ม Health Check สำหรับ Graph

```typescript
// เพิ่มใน /api/health
graphTableExists: boolean
graphRelationshipCount: number
```

### 5.2 ปรับ Error Handling

```typescript
// ตัวเลือก A: Throw error
} catch (error) {
  logNonFatal('graph.record_relationship', error, { rel });
  throw error;
}

// ตัวเลือก B: นับ failures
return {
  processed: docs.length,
  relationships: relationshipCount,
  failed: failedCount  // เพิ่มตัวนับ
};
```

### 5.3 เพิ่ม Checklist สำหรับ Feature ใหม่

เมื่อเพิ่ม table ใหม่:
- [ ] เพิ่มใน `schema.ts` (Drizzle)
- [ ] เพิ่มใน `runtime-schema.ts` (Auto-create)
- [ ] เพิ่มใน migration script (ถ้ามี)
- [ ] เขียน test case

---

## 6. ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | หน้าที่ | ต้องแก้ไข |
|------|---------|----------|
| `src/db/runtime-schema.ts` | Auto-create tables | ✅ ใช่ |
| `src/db/schema.ts` | Drizzle ORM schema | ไม่ |
| `src/knowledge-graph-service.ts` | Business logic | อาจพิจารณา |
| `src/server/routes/graph-routes.ts` | REST API | ไม่ |
| `scripts/migrate-p4-graph.ts` | Manual migration | ไม่ |

---

## 7. สรุป

| หัวข้อ | รายละเอียด |
|--------|------------|
| **ปัญหา** | Graph API แจ้ง success แต่ข้อมูลไม่ถูกบันทึก |
| **สาเหตุ** | Table `concept_relationships` ขาดจาก `runtime-schema.ts` |
| **ผลกระทบ** | Feature Knowledge Graph ใช้งานไม่ได้ |
| **การแก้ไข** | เพิ่ม table creation ใน `runtime-schema.ts` |
| **เวลาแก้ไข** | ~15 นาที (รวม build และ deploy) |

---

*รายงานโดย โจ (AI Developer Engineer)*
*14 มีนาคม 2026*
