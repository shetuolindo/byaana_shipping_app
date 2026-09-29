export type LoginActionState = {
  status: "idle" | "error";
  message?: string;
};

export const initialLoginActionState: LoginActionState = { status: "idle" };
