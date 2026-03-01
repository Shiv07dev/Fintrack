"use server";

import aj from "@/lib/arcjet";
import { db } from "@/lib/prisma";
import { request } from "@arcjet/next";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

const serializeTransaction = (obj) => {
  const serialized = { ...obj };

  if (obj.balance) {
    serialized.balance = obj.balance.toNumber();
  }

  if (obj.amount) {
    serialized.amount = obj.amount.toNumber();
  }

  return serialized;
};

// 🔥 Helper: Ensure user exists in DB
async function getOrCreateUser(clerkUserId) {
  let user = await db.user.findUnique({
    where: { clerkUserId },
  });

  if (!user) {
    user = await db.user.create({
      data: {
        clerkUserId,
        email: "",
        name: "",
      },
    });
  }

  return user;
}

// ==============================
// GET USER ACCOUNTS
// ==============================
export async function getUserAccounts() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getOrCreateUser(userId);

  try {
    const accounts = await db.account.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            transactions: true,
          },
        },
      },
    });

    return accounts.map(serializeTransaction);
  } catch (error) {
    console.error(error);
    return [];
  }
}

// ==============================
// CREATE ACCOUNT
// ==============================
export async function createAccount(data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await getOrCreateUser(userId);

    // ArcJet protection
    const req = await request();

    const decision = await aj.protect(req, {
      userId,
      requested: 1,
    });

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        throw new Error("Too many requests. Please try again later.");
      }

      throw new Error("Request blocked");
    }

    const balanceFloat = parseFloat(data.balance);

    if (isNaN(balanceFloat)) {
      throw new Error("Invalid balance amount");
    }

    const existingAccounts = await db.account.findMany({
      where: { userId: user.id },
    });

    const shouldBeDefault =
      existingAccounts.length === 0 ? true : data.isDefault;

    if (shouldBeDefault) {
      await db.account.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    const account = await db.account.create({
      data: {
        ...data,
        balance: balanceFloat,
        userId: user.id,
        isDefault: shouldBeDefault,
      },
    });

    revalidatePath("/dashboard");

    return {
      success: true,
      data: serializeTransaction(account),
    };
  } catch (error) {
    throw new Error(error.message);
  }
}

// ==============================
// GET DASHBOARD DATA
// ==============================
export async function getDashboardData() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getOrCreateUser(userId);

  const transactions = await db.transaction.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
  });

  return transactions.map(serializeTransaction);
}