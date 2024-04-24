import cron from "node-cron";
import { getTextClaude } from "./claude.js";
import { User } from "./model/User.js";
import { sendEmail } from "./claude.js";

const scheduledActions = {};

export const scheduleAction = async (action, schedule, userId) => {
    const user = await User.findById(userId);
    if (!user) {
        return "User not found";
    }

    const task = cron.schedule(schedule === "hourly" ? "0 * * * *" : "0 0 * * *", async () => {
        try {
            const result = await getTextClaude(action, 0.5, null, null, userId, "claude-3-haiku-20240307", null, true);
            user.info.set(`${schedule}_action_${Date.now()}`, action);
            user.info.set(`${schedule}_result_${Date.now()}`, result);
            await user.save();
            await sendEmail(user.email, `${schedule} action result`, result, userId);
        } catch (error) {
            console.error(`Error executing scheduled action: ${error}`);
        }
    });

    scheduledActions[userId] = task;
    return `Action "${action}" scheduled to run ${schedule}`;
};

export const stopScheduledAction = (userId) => {
    const task = scheduledActions[userId];
    if (task) {
        task.stop();
        delete scheduledActions[userId];
        return "Scheduled action stopped";
    } else {
        return "No scheduled action found for this user";
    }
};