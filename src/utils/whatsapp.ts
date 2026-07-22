import axios from 'axios';
import { env } from '../config/env.js';

export const branchSpecificData: Record<
  string,
  { phoneNo: string; branchName: string; addressLine1: string; addressLine2: string }
> = {
  'masjid-bunder': {
    phoneNo: '73032 64301',
    branchName: 'Navinchandra and Sons LLP',
    addressLine1: '250 Narshee Natha Street Bhaat Bazar Opp Fountain,',
    addressLine2: 'Masjid Bunder East - 400009',
  },
  bhuleshwar: {
    phoneNo: '93240 86690',
    branchName: 'Navinchandra and Sons',
    addressLine1: 'Mahavir Building, 5/A, K. M. Zaveri Road, Kumbhar Tukda, Bhuleshwar,',
    addressLine2: 'Mumbai - 400 002',
  },
};

interface TemplateComponent {
  type: 'body';
  parameters: { type: 'text'; parameter_name: string; text: string }[];
}

// Shared by every WhatsApp send: applies the dev safety net (redirects to
// WHATSAPP_TEST_OVERRIDE_NUMBER while set, so local testing can never
// message a real customer/vendor) and posts to the Graph API. Callers only
// need to supply the template name/language/params for their own message.
const postWhatsAppTemplate = async (
  phoneNo: string,
  templateName: string,
  languageCode: string,
  components: TemplateComponent[]
) => {
  const recipientNo = env.whatsappTestOverrideNumber || phoneNo;
  if (env.whatsappTestOverrideNumber && phoneNo !== env.whatsappTestOverrideNumber) {
    console.log(`[TEST OVERRIDE] Redirecting WhatsApp send from ${phoneNo} to ${env.whatsappTestOverrideNumber}`);
  }

  const whatsappData = {
    messaging_product: 'whatsapp',
    to: `91${recipientNo}`,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };

  try {
    const response = await axios.post(
      `https://graph.facebook.com/${env.whatsappApiVersion}/${env.whatsappPhoneNumberId}/messages`,
      whatsappData,
      { headers: { Authorization: `Bearer ${env.whatsappToken}`, 'Content-Type': 'application/json' } }
    );
    return response.data;
  } catch (error) {
    console.error('Error while sending WhatsApp message:', error);
    return { error: 'Failed to send WhatsApp message' };
  }
};

interface SendArgs {
  phoneNo: string;
  lrNo: string;
  transportName: string;
  transportPhoneNo: string;
}

export const sendWhatsAppMessage = (data: SendArgs, branchId: string) => {
  const { phoneNo, lrNo, transportName, transportPhoneNo } = data;
  return postWhatsAppTemplate(
    phoneNo,
    branchId === 'bhuleshwar' ? 'outward_message' : 'masjid_bunder_outward_message',
    branchId === 'bhuleshwar' ? 'en' : 'en_US',
    [
      {
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'lr_no', text: lrNo },
          { type: 'text', parameter_name: 'transport_name', text: transportName },
          { type: 'text', parameter_name: 'transport_phone_no', text: `91 ${transportPhoneNo}` },
        ],
      },
    ]
  );
};

interface PaymentReminderArgs {
  phoneNo: string;
  customerName: string;
  outstandingAmount: string;
}

// Requires a new Meta-approved template per branch (e.g. "payment_reminder" /
// "masjid_bunder_payment_reminder") — same external approval prerequisite as
// every other WhatsApp template this app uses; not something we control the
// timeline on.
export const sendPaymentReminderWhatsAppMessage = (data: PaymentReminderArgs, branchId: string) => {
  const { phoneNo, customerName, outstandingAmount } = data;
  return postWhatsAppTemplate(
    phoneNo,
    branchId === 'bhuleshwar' ? 'payment_reminder' : 'masjid_bunder_payment_reminder',
    branchId === 'bhuleshwar' ? 'en' : 'en_US',
    [
      {
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'customer_name', text: customerName },
          { type: 'text', parameter_name: 'outstanding_amount', text: outstandingAmount },
        ],
      },
    ]
  );
};
