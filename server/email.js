import { User } from "./model/User.js";
import { simpleParser } from "mailparser";
import imap from "imap";
import { getTextClaude } from "./claude.js";
import { sendEmail } from "./tools.js";
import dotenv from "dotenv";
import pdfParser from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import xlsx from "xlsx";
dotenv.config({ override: true });

export async function handleIncomingEmails() {
    try {
        const imapClient = new imap({
            user: process.env.EMAIL,
            password: process.env.EMAIL_PASSWORD,
            host: "imap.gmail.com",
            port: 993,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false,
            },
        });

        imapClient.once("ready", () => {
            imapClient.openBox("INBOX", false, () => {
                imapClient.search(["UNSEEN"], (err, results) => {
                    try {
                        if (err) {
                            console.error("Search Error:", err);
                            return;
                        }
                        const f = imapClient.fetch(results, { bodies: "", markSeen: true });
                        f.on("message", (msg) => {
                            let emailBody = "";
                            msg.on("body", (stream) => {
                                stream.on("data", (chunk) => {
                                    emailBody += chunk.toString("utf8");
                                });
                                stream.once("end", async () => {
                                    console.log("New email found");
                                    const emailFrom = await simpleParser(emailBody);
                                    const user = await User.findOne({
                                        email: emailFrom?.from?.value?.[0]?.address,
                                    });
                                    if (user && emailBody) {
                                        // Check if the email has attachments
                                        const attachments = emailFrom.attachments;
                                        if (attachments && attachments.length > 0) {
                                            for (const attachment of attachments) {
                                                const fileType = attachment.contentType;
                                                const fileBytes = attachment.content;

                                                if (fileType === "application/pdf") {
                                                    const data = await pdfParser(fileBytes);
                                                    emailBody += `\n\n${data.text}`;
                                                } else if (
                                                    fileType === "application/msword" ||
                                                    fileType ===
                                                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                                ) {
                                                    const docResult = await mammoth.extractRawText({
                                                        buffer: fileBytes,
                                                    });
                                                    emailBody += `\n\n${docResult.value}`;
                                                } else if (
                                                    fileType === "application/xlsx" ||
                                                    fileType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                                ) {
                                                    const workbook = xlsx.read(fileBytes, { type: "buffer" });
                                                    const sheetNames = workbook.SheetNames;
                                                    let excelText = "";
                                                    sheetNames.forEach((sheetName) => {
                                                        const worksheet = workbook.Sheets[sheetName];
                                                        excelText += xlsx.utils.sheet_to_text(worksheet);
                                                    });
                                                    emailBody += `\n\n${excelText}`;
                                                } else {
                                                    console.warn(`Unsupported file type: ${fileType}`);
                                                }
                                            }
                                        }

                                        const response = await getTextClaude(
                                            //TODO: some user context and attachments
                                            emailFrom.subject + "\n" + emailBody,
                                            0.2,
                                            null,
                                            null,
                                            user._id,
                                            "claude-3-haiku-20240307",
                                            null,
                                            true
                                        );
                                        if (response) {
                                            const emailSignature = `\n\n---\nBest regards,\nAllChat`;
                                            await sendEmail(
                                                emailFrom.from.value[0].address,
                                                "RE: " + emailFrom.subject,
                                                response + emailSignature
                                            );
                                        } else {
                                            console.error(
                                                "No response generated for email from:",
                                                emailFrom.from.value[0].address
                                            );
                                        }
                                    } else {
                                        console.error("User not found or email content is empty");
                                    }
                                });
                            });
                        });

                        f.once("error", (err) => {
                            console.error("IMAP fetch error:", err.message);
                        });
                    } catch (err) {
                        return;
                    }
                });
            });
        });

        imapClient.once("error", (err) => {
            console.error("Error connecting to IMAP server:", err);
        });

        imapClient.connect();
    } catch (err) {
        console.error("Error handling incoming emails:", err);
    }
}
