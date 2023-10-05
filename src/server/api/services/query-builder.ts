import {
  type singleFilter,
  type timeFilter,
} from "@/src/server/api/interfaces/filters";
import { type ColumnDefinition } from "@/src/server/api/interfaces/tableDefinition";
import { Prisma, type PrismaClient } from "@prisma/client";
import { type Sql } from "@prisma/client/runtime/library";
import Decimal from "decimal.js";
import { type z } from "zod";
import { type sqlInterface } from "./sqlInterface";
import { tableDefinitions } from "./tableDefinitions";

export type InternalDatabaseRow = {
  [key: string]: bigint | number | Decimal | string | Date;
};

export type DatabaseRow = {
  [key: string]: string | number | Date;
};

export const executeQuery = async (
  prisma: PrismaClient,
  projectId: string,
  query: z.TypeOf<typeof sqlInterface>,
) => {
  const sql = enrichAndCreateQuery(projectId, query);

  const response = await prisma.$queryRaw<InternalDatabaseRow[]>(sql);

  const parsedResult = outputParser(response);

  return parsedResult;
};

export const enrichAndCreateQuery = (
  projectId: string,
  query: z.TypeOf<typeof sqlInterface>,
) => {
  return createQuery({
    ...query,
    filter: [...query.filter, ...getMandatoryFilter(query.from, projectId)],
  });
};

export const createQuery = (query: z.TypeOf<typeof sqlInterface>) => {
  const cte = createDateRangeCte(query.from, query.filter, query.groupBy);

  const fromString = cte?.from ?? Prisma.sql` FROM ${getTableSql(query.from)}`;

  const selectFields = query.select.map((field) =>
    // raw mandatory everywhere here as this creates the selection
    // agg is typed via zod
    // column names come from our defs via the table definitions
    field.agg
      ? Prisma.sql`${Prisma.raw(field.agg)}(${getInternalSql(
          getColumnSql(query.from, field.column),
        )}) as "${Prisma.raw(field.agg.toLowerCase())}${Prisma.raw(
          capitalizeFirstLetter(field.column),
        )}"`
      : Prisma.sql`${getInternalSql(
          getColumnSql(query.from, field.column),
        )} as "${Prisma.raw(getColumnSql(query.from, field.column).name)}"`,
  );

  if (cte)
    // raw mandatory here
    selectFields.unshift(
      Prisma.sql`date_series."date" as "${Prisma.raw(cte.column.name)}"`,
    );

  let groupString = Prisma.empty;

  if (query.groupBy.length > 0 || cte) {
    const groupByFields = query.groupBy.map((groupBy) =>
      prepareGroupBy(query.from, groupBy),
    );
    groupString =
      groupByFields.length > 0
        ? Prisma.sql` GROUP BY ${Prisma.join(groupByFields, ", ")}`
        : Prisma.empty;
  }
  const selectString =
    selectFields.length > 0
      ? Prisma.sql` SELECT ${Prisma.join(selectFields, ", ")}`
      : Prisma.empty;

  const orderByString = prepareOrderByString(
    query.orderBy,
    tableDefinitions[query.from]!.columns,
    cte ? true : false,
  );

  const filterString =
    query.filter.length > 0
      ? Prisma.sql` ${
          cte ? Prisma.sql` AND ` : Prisma.sql` WHERE `
        } ${prepareFilterString(
          query.from,
          query.filter,
          tableDefinitions[query.from]!.columns,
        )}`
      : Prisma.empty;

  return Prisma.sql`${
    cte?.cte ?? Prisma.empty
  }${selectString}${fromString}${filterString}${groupString}${orderByString};`;
};

const prepareOrderByString = (
  orderBy: z.infer<typeof sqlInterface>["orderBy"],
  columnDefinitions: ColumnDefinition[],
  hasCte: boolean,
): Prisma.Sql => {
  const orderBys = orderBy.map((orderBy) => {
    const column = columnDefinitions.find((x) => x.name === orderBy.column);
    if (!column) {
      console.error(`Column ${orderBy.column} not found`);
      throw new Error(`Column ${orderBy.column} not found`);
    }

    // raw mandatory here
    return Prisma.sql`${getInternalSql(column)} ${Prisma.raw(
      orderBy.direction,
    )}`;
  });
  const addedCte = hasCte
    ? [Prisma.sql`date_series."date" ASC`, ...orderBys]
    : orderBys;

  return addedCte.length > 0
    ? Prisma.sql` ORDER BY ${Prisma.join(addedCte, ", ")}`
    : Prisma.empty;
};

const prepareFilterString = (
  table: z.infer<typeof sqlInterface>["from"],
  filter: z.infer<typeof sqlInterface>["filter"],
  columnDefinitions: ColumnDefinition[],
): Prisma.Sql => {
  const filters = filter.map((filter) => {
    const column = columnDefinitions.find((x) => x.name === filter.column);
    if (!column) {
      console.error(`Column ${filter.column} not found`);
      throw new Error(`Column ${filter.column} not found`);
    }
    // raw manfatory for column defs and operator
    // non raw for value, which will go into parameterised string
    if (filter.type === "datetime") {
      return Prisma.sql`${getInternalSql(column)} ${Prisma.raw(
        filter.operator,
      )} ${filter.value}`;
    } else {
      return Prisma.sql`${getInternalSql(column)} ${Prisma.raw(
        filter.operator,
      )} ${filter.value} ${
        column.name === "type" && table === "observations"
          ? Prisma.sql`::"ObservationType"`
          : Prisma.empty
      }`;
    }
  });
  return Prisma.join(filters, " AND ");
};

const prepareGroupBy = (
  table: z.infer<typeof sqlInterface>["from"],
  groupBy: z.infer<typeof sqlInterface>["groupBy"][number],
) => {
  const internalColumn = getInternalSql(getColumnSql(table, groupBy.column));
  if (groupBy.type === "datetime") {
    return Prisma.sql`date_series."date"`;
  } else {
    return internalColumn;
  }
};

function isTimeRangeFilter(
  filter: z.infer<typeof sqlInterface>["filter"][number],
): filter is z.infer<typeof timeFilter> {
  return filter.type === "datetime";
}

const createDateRangeCte = (
  from: z.infer<typeof sqlInterface>["from"],
  filters: z.infer<typeof singleFilter>[],
  groupBy: z.infer<typeof sqlInterface>["groupBy"],
) => {
  const groupByColumns = groupBy.filter((x) => x.type === "datetime");

  if (groupByColumns.length === 0) return undefined;
  if (groupByColumns.length > 1)
    throw new Error("Only one datetime group by is supported");

  const groupByColumn = groupByColumns[0];

  const dateTimeFilters = filters.filter(isTimeRangeFilter);

  const minDateColumn =
    dateTimeFilters.length > 1
      ? dateTimeFilters.find((x) => x.operator === ">" || x.operator === ">=")
      : undefined;

  const maxDateColumn =
    dateTimeFilters.length > 1
      ? dateTimeFilters.find((x) => x.operator === "<" || x.operator === "<=")
      : undefined;

  if (
    groupByColumn &&
    "temporalUnit" in groupByColumn &&
    minDateColumn &&
    maxDateColumn
  ) {
    if (
      minDateColumn?.column !== groupByColumn?.column ||
      maxDateColumn?.column !== groupByColumn?.column
    ) {
      throw new Error(
        "Min date column, max date column must match group by column",
      );
    }

    const startColumn = getColumnSql(from, minDateColumn.column);

    // raw mandatory for temporal unit. From and to are parameterised values
    // temporal unit is typed
    const cteString = Prisma.sql`
      WITH date_series AS (
        SELECT generate_series(${minDateColumn.value}, ${
          maxDateColumn.value
        }, '1 ${Prisma.raw(groupByColumn.temporalUnit)}') as date
      )
    `;

    // as above, raw is mandatory for columns and temporal unit
    const modifiedFrom = Prisma.sql` FROM date_series LEFT JOIN ${getTableSql(
      from,
    )} ON DATE_TRUNC('${Prisma.raw(
      groupByColumn.temporalUnit,
    )}', ${getInternalSql(startColumn)}) = DATE_TRUNC('${Prisma.raw(
      groupByColumn.temporalUnit,
    )}', date_series."date")`;

    return { cte: cteString, from: modifiedFrom, column: startColumn };
  }

  return undefined;
};

const getTableSql = (
  table: z.infer<typeof sqlInterface>["from"],
): Prisma.Sql => {
  // raw required here, everyrhing is typed
  return Prisma.raw(tableDefinitions[table]!.table);
};

const getColumnSql = (
  table: z.infer<typeof sqlInterface>["from"],
  column: string,
): ColumnDefinition => {
  const foundColumn = tableDefinitions[table]!.columns.find((c) => {
    return c.name === column;
  });
  if (!foundColumn) {
    console.error(`Column ${column} not found in table ${table}`);
    throw new Error(`Column ${column} not found in table ${table}`);
  }
  return foundColumn;
};

const getInternalSql = (colDef: ColumnDefinition): Sql =>
  // raw required here, everything is typed
  Prisma.raw(colDef.internal);

const outputParser = (output: InternalDatabaseRow[]): DatabaseRow[] => {
  return output.map((row) => {
    const newRow: DatabaseRow = {};
    for (const key in row) {
      const val = row[key];
      if (typeof val === "bigint") {
        newRow[key] = Number(val);
      } else if (typeof val === "number") {
        newRow[key] = val;
      } else if (Decimal.isDecimal(val)) {
        newRow[key] = val.toNumber();
      } else if (typeof val === "string") {
        newRow[key] = val;
      } else if (val instanceof Date) {
        newRow[key] = val;
      } else if (val === null) {
        newRow[key] = val;
      } else {
        console.log(`Unknown type ${typeof val} for ${val}`);
        throw new Error(`Unknown type ${typeof val}`);
      }
    }
    return newRow;
  });
};

function capitalizeFirstLetter(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const getMandatoryFilter = (
  table: z.infer<typeof sqlInterface>["from"],
  projectId: string,
) => {
  const observationFilter = {
    type: "string" as const,
    column: "observationsProjectId",
    operator: "=" as const,
    value: projectId,
  };

  const traceFilter = {
    type: "string" as const,
    column: "tracesProjectId",
    operator: "=" as const,
    value: projectId,
  };

  switch (table) {
    case "traces":
    case "traces_scores":
      return [traceFilter];
    case "traces_observations":
    case "traces_parent_observation_scores":
      return [traceFilter, observationFilter];
    case "observations":
      return [observationFilter];
  }
};