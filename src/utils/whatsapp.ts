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

interface SendArgs {
  phoneNo: string;
  lrNo: string;
  transportName: string;
  transportPhoneNo: string;
}

// Same dev safety net we built for the old backend, ported as-is: while
// WHATSAPP_TEST_OVERRIDE_NUMBER is set (only meant for local dev — leave
// blank in production), every send redirects there instead of the real
// recipient, so testing this flow can never message a real customer.
export const sendWhatsAppMessage = async (data: SendArgs, branchId: string) => {
  const { phoneNo, lrNo, transportName, transportPhoneNo } = data;
  const recipientNo = env.whatsappTestOverrideNumber || phoneNo;
  if (env.whatsappTestOverrideNumber && phoneNo !== env.whatsappTestOverrideNumber) {
    console.log(`[TEST OVERRIDE] Redirecting WhatsApp send from ${phoneNo} to ${env.whatsappTestOverrideNumber}`);
  }

  const whatsappData = {
    messaging_product: 'whatsapp',
    to: `91${recipientNo}`,
    type: 'template',
    template: {
      name: branchId === 'bhuleshwar' ? 'outward_message' : 'masjid_bunder_outward_message',
      language: { code: branchId === 'bhuleshwar' ? 'en' : 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', parameter_name: 'lr_no', text: lrNo },
            { type: 'text', parameter_name: 'transport_name', text: transportName },
            { type: 'text', parameter_name: 'transport_phone_no', text: `91 ${transportPhoneNo}` },
          ],
        },
      ],
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
