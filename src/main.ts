// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor } from 'apify';
// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { CheerioCrawler, Dataset, createCheerioRouter, EnqueueStrategy, Request } from 'crawlee';
// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// read more about this here: https://nodejs.org/docs/latest-v18.x/api/esm.html#mandatory-file-extensions
// note that we need to use `.js` even when inside TS files
// import { router } from './routes.js';

// Define the input schema for the actor
interface Input {
    searchUrl: string;
    maxJobs: number;
}

// Define a contact person data structure
interface ContactPersonData {
    name: string;
    role?: string;
    phoneNumber?: string;
    email?: string;
}

// Define the job data structure
interface JobData {
    url: string;
    title: string;
    description: string;
    company: string;
    contactPersons?: ContactPersonData[]; // Array of contact persons
    email?: string;
    applicationUrl?: string;
    location?: string;
    employmentType?: string;
    salary?: string;
    publicationDate?: string;
    expirationDate?: string;
    finnkode?: string;
    companyLogoUrl?: string;
}

// Initialize the Actor
await Actor.init();

// Get input from the user
const input = await Actor.getInput<Input>();
const searchUrl = input?.searchUrl || 'https://www.finn.no/job/fulltime/search.html?occupation=0.23&occupation=0.22';
const maxJobs = input?.maxJobs || 100;

console.log('Starting crawler with URL:', searchUrl);

// Set up proxy configuration
const proxyConfiguration = await Actor.createProxyConfiguration();

// Create a counter to track how many jobs we've scraped
let scrapedJobsCount = 0;

// Create a router for handling different URL patterns
const router = createCheerioRouter();

// Handle the search results page
router.addHandler('LIST', async ({ request, $, log, enqueueLinks }) => {
    log.info(`Processing search results page ${request.url}`);
    
    // Verify this is actually a Finn.no search page
    if (!request.url.includes('finn.no')) {
        log.warning(`Skipping non-Finn.no URL: ${request.url}`);
        return;
    }
    
    // Debug: Log the raw HTML to check what we're getting
    log.info('HTML structure check:', {
        bodyLength: $('body').html()?.length || 0,
        hasJobsList: Boolean($('.ads__unit').length || $('.f-card').length || $('.sf-search-ad').length),
        possibleJobSelectors: {
            adsUnit: $('.ads__unit').length,
            fCard: $('.f-card').length,
            searchAd: $('.sf-search-ad').length,
            genericAnchor: $('a[href*="/job/fulltime/ad.html"]').length
        }
    });
    
    // Try multiple selector patterns to find job listings
    let jobLinks = $('.ads__unit > .ads__unit__link'); // Original selector
    
    // If the original selector doesn't find anything, try alternative selectors
    if (jobLinks.length === 0) {
        jobLinks = $('.f-card--job a');
    }
    
    if (jobLinks.length === 0) {
        jobLinks = $('.sf-search-ad a');
    }
    
    if (jobLinks.length === 0) {
        jobLinks = $('a[href*="/job/fulltime/ad.html"]');
    }
    
    log.info(`Found ${jobLinks.length} job listings on this page`);
    
    // Check if we've reached the maximum number of jobs
    const remainingJobs = maxJobs - scrapedJobsCount;
    
    if (remainingJobs <= 0) {
        log.info('Reached the maximum number of jobs to scrape. Stopping the crawler.');
        return;
    }
    
    // If we found links using a generic selector, enqueue them directly
    if (jobLinks.length > 0 && $('a[href*="/job/fulltime/ad.html"]').length > 0) {
        // Get all the href attributes
        const urls: string[] = [];
        jobLinks.each((_, element) => {
            const href = $(element).attr('href');
            if (href && href.includes('/job/fulltime/ad.html')) {
                // Make absolute URL if it's relative
                const url = href.startsWith('http') ? href : `https://www.finn.no${href}`;
                urls.push(url);
            }
        });
        
        // Enqueue the URLs directly
        for (let i = 0; i < Math.min(urls.length, remainingJobs); i++) {
            await crawler.addRequests([{
                url: urls[i],
                label: 'DETAIL'
            }]);
        }
        
        log.info(`Directly enqueued ${Math.min(urls.length, remainingJobs)} job detail pages`);
    } else {
        // Enqueue individual job detail pages using the enqueueLinks method
        await enqueueLinks({
            selector: jobLinks.length > 0 ? jobLinks.toString() : 'a[href*="/job/fulltime/ad.html"]',
            label: 'DETAIL',
            limit: remainingJobs,
            transformRequestFunction: (req) => {
                // Ensure we always have a label
                req.label = 'DETAIL';
                return req;
            },
        });
    }
    
    // Find pagination links
    let paginationLinks = $('a.pagination__page');
    
    if (paginationLinks.length === 0) {
        paginationLinks = $('a[href*="page="]');
    }
    
    // Enqueue next page if we need more jobs
    if (remainingJobs > jobLinks.length && paginationLinks.length > 0) {
        log.info(`Found ${paginationLinks.length} pagination links, enqueueing next pages`);
        await enqueueLinks({
            selector: paginationLinks.length > 0 ? paginationLinks.toString() : 'a[href*="page="]',
            strategy: EnqueueStrategy.All,
            label: 'LIST',
            transformRequestFunction: (req) => {
                // Ensure we always have a label
                req.label = 'LIST';
                return req;
            },
        });
    }
});

// Handle the job detail page
router.addHandler('DETAIL', async ({ request, $, log }) => {
    log.info(`Processing job detail page ${request.url}`);
    
    try {
        // Extract the finnkode (job ID) from the URL
        const finnkodeMatch = request.url.match(/finnkode=(\d+)/);
        const finnkode = finnkodeMatch ? finnkodeMatch[1] : undefined;
        
        // Extract job title - both main title and subtitle
        const mainTitle = $('h2.t2, h2.t3, h1.t2, h1.t3, .t2, .t1').first().text().trim();
        const subTitle = $('h1').first().text().trim();
        const title = mainTitle || subTitle;
        
        // Extract company name with improved extraction logic
        let company = '';

        // 1. Try the most reliable method first - from the subtitle under the main title
        company = $('section.space-y-16 > p').first().text().trim();

        // 2. If that fails, try from the metadata definition list ("Firma")
        if (!company) {
            const firmaElement = $('dt:contains("Firma")').next('dd');
            if (firmaElement.length > 0) {
                company = firmaElement.text().trim();
            }
        }

        // 3. Try from the logo alt text if it exists
        if (!company) {
            const logoAlt = $('.company-logo img').attr('alt');
            if (logoAlt && logoAlt.includes('logo')) {
                company = logoAlt.replace(/\slogo$/i, '').trim();
            }
        }

        // 4. Last resort - try from any structured data available
        if (!company) {
            // Look for any element that might contain the company name
            company = $('span:contains("Firma:")').parent().text().replace('Firma:', '').trim() ||
                    $('h2:contains("Om arbeidsgiveren")').next('div').find('p').first().text().trim() ||
                    $('div.job-extended-profile-podlet-expandable').text().split('Les om arbeidsplassen')[0].trim();
        }
        
        // Extract company logo URL
        const companyLogoUrl = $('.company-logo img, img[alt*="logo"]').attr('src') || undefined;
        
        // Get the main job description but truncate it to a reasonable size
        let description = '';
        const descriptionSection = $('section:contains("En vanlig arbeidsdag"), section[aria-label="Jobbdetaljer"]');
        
        if (descriptionSection.length > 0) {
            // Extract main sections and truncate
            const workDuties = $('h3:contains("arbeidsoppgaver"), h3:contains("Dette vil du jobbe med"), h3:contains("Dette kommer du til"), h3:contains("Hva blir dine oppgaver")')
                .parent()
                .find('ul')
                .first();
                
            const qualifications = $('h3:contains("Kvalifikasjoner"), h3:contains("Vi søker deg"), h3:contains("Hvem er du"), h3:contains("Du må ha")')
                .parent()
                .find('ul')
                .first();
                
            // Create a concise description
            let sections = [];
            if (workDuties && workDuties.length > 0) {
                sections.push("<h3>Arbeidsoppgaver</h3>" + workDuties.html());
            }
            
            if (qualifications && qualifications.length > 0) {
                sections.push("<h3>Kvalifikasjoner</h3>" + qualifications.html());
            }
            
            // If we couldn't extract specific sections, use a truncated version of the whole description
            if (sections.length === 0) {
                description = $('section:contains("En vanlig arbeidsdag"), section[aria-label="Jobbdetaljer"], .import-decoration').html() || '';
                // Truncate if too long
                if (description.length > 2000) {
                    description = description.substring(0, 2000) + '... (truncated)';
                }
            } else {
                description = sections.join('');
            }
        } else {
            // Fallback to general content but truncate
            description = $('section .import-decoration').html() || '';
            if (description.length > 2000) {
                description = description.substring(0, 2000) + '... (truncated)';
            }
        }
        
        // Extract contact information
        const jobDetailsText = $('body').text();
        
        // Define standard TLDs to check against - used throughout the email processing
        const standardTLDs = ['no', 'com', 'org', 'net', 'info', 'se', 'dk', 'io', 'co', 'uk', 'us', 'eu', 'de', 'fr', 'it', 'es', 'pl', 'ru', 'nl', 'be', 'me', 'biz', 'group'];

        
        // Improved regex to find email addresses in the content - with better boundaries
        const emailRegex = /(^|[^a-zA-Z0-9])([\w.+-]+@[\w-]+\.[\w.-]+)([^a-zA-Z0-9]|$)/g;
        
        // For debugging - log the extraction process
        const debugEmailExtraction = false; // Set to true to enable debugging
        
        // Extract all email matches from the content
        const rawEmailMatches: string[] = [];
        let match;
        
        while ((match = emailRegex.exec(jobDetailsText)) !== null) {
            // The email is in capture group 2
            if (match[2]) {
                rawEmailMatches.push(match[2]);
                if (debugEmailExtraction) {
                    log.debug(`Found email with boundary match: ${match[2]}`);
                }
            }
        }
        
        // If we didn't find any emails with the strict pattern, try a more lenient one
        if (rawEmailMatches.length === 0) {
            // Try to find any email pattern followed by a standard TLD
            for (const tld of standardTLDs) {
                const tldEmailRegex = new RegExp(`[\\w.+-]+@[\\w-]+\\.${tld}`, 'gi');
                let tldMatch;
                
                while ((tldMatch = tldEmailRegex.exec(jobDetailsText)) !== null) {
                    if (debugEmailExtraction) {
                        log.debug(`Found email with standard TLD '${tld}': ${tldMatch[0]}`);
                    }
                    rawEmailMatches.push(tldMatch[0]);
                }
            }
            
            // If we still don't have any matches, try the generic pattern as a last resort
            if (rawEmailMatches.length === 0) {
                // We'll use a hybrid approach when the strict pattern fails:
                // 1. Find emails with the basic pattern
                // 2. For each match, look for word boundaries or common words
                
                const simpleEmailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
                let simpleMatch;
                
                while ((simpleMatch = simpleEmailRegex.exec(jobDetailsText)) !== null) {
                    const potentialEmail = simpleMatch[0];
                    
                    // Get some context - check characters before and after this match
                    const startPos = simpleMatch.index;
                    const endPos = startPos + potentialEmail.length;
                    
                    // Get 10 characters before and after for context
                    const beforeContext = startPos > 10 ? jobDetailsText.substring(startPos - 10, startPos) : jobDetailsText.substring(0, startPos);
                    const afterContext = endPos + 10 < jobDetailsText.length ? jobDetailsText.substring(endPos, endPos + 10) : jobDetailsText.substring(endPos);
                    
                    if (debugEmailExtraction) {
                        log.debug(`Found potential email: ${potentialEmail}`);
                        log.debug(`Context: ...${beforeContext}[${potentialEmail}]${afterContext}...`);
                    }
                    
                    rawEmailMatches.push(potentialEmail);
                }
            }
        }
        
        if (debugEmailExtraction) {
            log.debug(`Found ${rawEmailMatches.length} raw email matches before cleaning`);
        }
        
        // Function to clean and validate email addresses
        const cleanEmail = (dirtyEmail: string): string | undefined => {
            if (debugEmailExtraction) {
                log.debug(`Cleaning email: "${dirtyEmail}"`);
            }

            // STEP 1: Basic input cleaning
            let cleanedInput = dirtyEmail
                .replace(/\s+/g, '') // Remove whitespace
                .replace(/&nbsp;/g, '') // Remove HTML entities
                .replace(/[,;:()<>[\]]/g, '') // Remove common punctuation
                .replace(/\[(at|et)\]|\(at\)|@\[at\]/gi, '@') // Replace [at], (at), etc. with @
                .replace(/\[(dot|punkt)\]|\(dot\)|\(punktum\)/gi, '.'); // Replace [dot], (dot), etc.

            if (debugEmailExtraction) {
                log.debug(`After basic cleaning: "${cleanedInput}"`);
            }

            // STEP 2: Direct matching for standard email with valid TLD
            const extractedEmail = extractStandardEmail(cleanedInput);
            
            if (extractedEmail) {
                if (debugEmailExtraction) {
                    log.debug(`Extracted standard email: "${extractedEmail}"`);
                }
                return extractedEmail;
            }

            // STEP 3: If no standard email found, attempt more aggressive extraction
            const rescuedEmail = attemptEmailRescue(cleanedInput);
            
            if (debugEmailExtraction && rescuedEmail) {
                log.debug(`Rescued email: "${rescuedEmail}"`);
            }
            
            return rescuedEmail;
            
            // Helper function to extract a standard email with a valid TLD
            function extractStandardEmail(input: string): string | undefined {
                // Create a regex that matches emails ending with one of our standard TLDs
                const tldPattern = standardTLDs.map(escapeDot).join('|');
                const emailRegex = new RegExp(`(^|[^a-zA-Z0-9])([\\w.+-]+@[\\w-]+\\.(${tldPattern}))($|[^a-zA-Z0-9])`, 'i');
                
                const match = input.match(emailRegex);
                if (match?.[2]) {
                    return match[2];
                }
                
                return undefined;
            }
            
            // Helper function to attempt more aggressive email extraction for edge cases
            function attemptEmailRescue(input: string): string | undefined {
                // Look for patterns that resemble emails but might have junk attached
                const potentialEmailMatch = input.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
                if (!potentialEmailMatch) return undefined;
                
                const potentialEmail = potentialEmailMatch[0];
                
                // Find the @ symbol
                const atPos = potentialEmail.indexOf('@');
                if (atPos === -1) return undefined;
                
                // Look for valid TLDs in the potential email
                for (const tld of standardTLDs) {
                    const dotTldPos = potentialEmail.toLowerCase().indexOf(`.${tld}`, atPos);
                    if (dotTldPos > atPos) {
                        // Found a valid TLD - extract up to the end of the TLD
                        const extractedPart = potentialEmail.substring(0, dotTldPos + tld.length + 1);
                        
                        // Validate the extracted part as a proper email
                        if (/^[\w.+-]+@[\w-]+\.\w+$/.test(extractedPart)) {
                            return extractedPart;
                        }
                    }
                }
                
                // If TLD detection didn't work, try to find if any common words are attached
                const commonWords = [
                    'Telefon', 'telefon', 'Tlf', 'tlf', 'Mobil', 'mobil',
                    'Name', 'name', 'Navn', 'navn', 'Kontakt', 'kontakt',
                    'Email', 'email'
                ];
                
                // Find the last dot after @
                const lastDotPos = potentialEmail.lastIndexOf('.', potentialEmail.length);
                if (lastDotPos > atPos) {
                    // Check if any common word appears immediately after what might be a TLD
                    for (const word of commonWords) {
                        // Look for the word after a potential TLD (2-6 chars after the last dot)
                        for (let tldLength = 2; tldLength <= 6; tldLength++) {
                            const checkPos = lastDotPos + tldLength + 1;
                            if (checkPos < potentialEmail.length) {
                                if (potentialEmail.substring(checkPos).startsWith(word)) {
                                    // Found a word attached to what seems like a TLD
                                    const candidateEmail = potentialEmail.substring(0, checkPos);
                                    if (/^[\w.+-]+@[\w-]+\.\w+$/.test(candidateEmail)) {
                                        return candidateEmail;
                                    }
                                }
                            }
                        }
                    }
                    
                    // If we still haven't found a match, use a default approach:
                    // Assume the TLD is 2-3 characters long (most common)
                    const tldEndPos = lastDotPos + 4; // .com, .org, .net, .no, etc. (3 chars + dot)
                    if (tldEndPos <= potentialEmail.length) {
                        const candidateEmail = potentialEmail.substring(0, tldEndPos);
                        if (/^[\w.+-]+@[\w-]+\.\w+$/.test(candidateEmail)) {
                            return candidateEmail;
                        }
                    }
                }
                
                return undefined;
            }
            
            // Helper to escape dots in string for regex
            function escapeDot(str: string): string {
                return str.replace('.', '\\.');
            }
        };
        
        // Clean the found emails
        const cleanEmails = rawEmailMatches
            .map(cleanEmail)
            .filter((email): email is string => email !== undefined);
        
        // Use the first clean email as the main email
        const email = cleanEmails.length > 0 ? cleanEmails[0] : undefined;
        
        // Use regex to find phone numbers in the content
        const phoneRegex = /\+?\d[\d\s\-]{7,}/g; // Note the 'g' flag to find all matches
        const phoneMatches = jobDetailsText.match(phoneRegex) || [];
        
        // Clean and format phone numbers - collect them in a map for later association with contacts
        const cleanedPhones: string[] = [];
        let phoneNumber = undefined;
        
        if (phoneMatches.length > 0) {
            // Format multiple phone numbers
            phoneMatches.forEach(phone => {
                // Clean up the phone number
                const cleanPhone = phone.replace(/\s+/g, ' ').trim();
                cleanedPhones.push(cleanPhone);
            });
            
            // Remove duplicates
            const uniquePhones = [...new Set(cleanedPhones)];
            
            // Limit to max 3 phone numbers and format nicely for the main phoneNumber field
            phoneNumber = uniquePhones.slice(0, 3).join(' / ');
        }
        
        // Find contact persons - create an array to store multiple contacts
        const contactPersons: ContactPersonData[] = [];
        
        // Get all contact person elements
        const contactElements = $('span.pr-8.font-bold:contains("Kontaktperson")').parent('li');
        
        if (contactElements.length > 0) {
            // Multiple or single contact person in structured format
            contactElements.each((_, element) => {
                const fullText = $(element).text().replace('Kontaktperson:', '').trim();
                const name = fullText;
                
                // Try to extract phone/email for this contact
                let contactPhone = undefined;
                let contactEmail = undefined;
                let contactRole = undefined;
                
                // Look for adjacent li elements that might have a phone, email, or role
                const parentUl = $(element).parent('ul');
                const nextLi = $(element).next('li');
                
                // Check for mobile phone in various formats
                if (nextLi.length > 0 && nextLi.text().includes('Mobil')) {
                    contactPhone = nextLi.text().replace('Mobil:', '').trim();
                } else {
                    // Check for phone in the same list
                    const phoneLi = parentUl.find('li:contains("Telefon"), li:contains("Mobil"), li:contains("Tlf")');
                    if (phoneLi.length > 0) {
                        contactPhone = phoneLi.text().replace(/Telefon:|Mobil:|Tlf:/gi, '').trim();
                    } else {
                        // Try to match any phone number near this contact's section
                        const contactSectionText = parentUl.text();
                        
                        // Check if any of our previously found phone numbers appears near this contact's name
                        for (const phone of cleanedPhones) {
                            if (contactSectionText.includes(phone)) {
                                contactPhone = phone;
                                break;
                            }
                        }
                        
                        // If still no match, look for any phone number in this section
                        if (!contactPhone) {
                            const contactSectionPhoneMatch = contactSectionText.match(phoneRegex);
                            if (contactSectionPhoneMatch) {
                                contactPhone = contactSectionPhoneMatch[0].replace(/\s+/g, ' ').trim();
                            }
                        }
                    }
                }
                
                // Check for role/job title
                const titleLi = parentUl.find('li:contains("Stillingstittel")');
                if (titleLi.length > 0) {
                    contactRole = titleLi.text().replace('Stillingstittel:', '').trim();
                }
                
                // Check for nearby email elements
                const emailLi = parentUl.find('li:contains("E-post")');
                if (emailLi.length > 0) {
                    const dirtyEmail = emailLi.text().replace('E-post:', '').trim();
                    contactEmail = cleanEmail(dirtyEmail);
                } else {
                    // Try to find an email address near this contact's name in the job description
                    const contactSection = $(element).parent().html() || '';
                    const contactEmailMatches = contactSection.match(emailRegex);
                    if (contactEmailMatches && contactEmailMatches.length > 0) {
                        contactEmail = cleanEmail(contactEmailMatches[0]);
                    }
                }
                
                // Add this contact to our array
                contactPersons.push({
                    name,
                    role: contactRole,
                    phoneNumber: contactPhone,
                    email: contactEmail
                });
            });
        } else if ($('li:contains("Kontaktperson")').length > 0) {
            // Alternative format
            const contactPersonName = $('li:contains("Kontaktperson")').text().replace('Kontaktperson', '').trim();
            
            // For this format, try to find phone number near this contact
            const contactLi = $('li:contains("Kontaktperson")');
            const parentList = contactLi.parent();
            let contactPhone = undefined;
            let contactEmail = undefined;
            
            // Check if there's a phone number in the same list
            const phoneLi = parentList.find('li:contains("Telefon"), li:contains("Mobil"), li:contains("Tlf")');
            if (phoneLi.length > 0) {
                contactPhone = phoneLi.text().replace(/Telefon:|Mobil:|Tlf:/gi, '').trim();
            } else if (phoneNumber) {
                // Use the main phone number as fallback
                contactPhone = phoneNumber;
            }
            
            // Check for email in the same list
            const emailLi = parentList.find('li:contains("E-post")');
            if (emailLi.length > 0) {
                const dirtyEmail = emailLi.text().replace('E-post:', '').trim();
                contactEmail = cleanEmail(dirtyEmail);
            } else if (email) {
                // Use main email as fallback
                contactEmail = email;
            }
            
            contactPersons.push({ 
                name: contactPersonName,
                phoneNumber: contactPhone,
                email: contactEmail
            });
        } else if ($('strong:contains("Rekrutterende leder")').length > 0) {
            // Check for recruiting manager info
            const leaderInfo = $('strong:contains("Rekrutterende leder")').parent().text();
            const leaderName = leaderInfo.replace('Rekrutterende leder:', '').split('|')[0].trim();
            
            // Try to extract phone from the leader info
            let contactPhone = undefined;
            const leaderPhoneMatch = leaderInfo.match(phoneRegex);
            if (leaderPhoneMatch) {
                contactPhone = leaderPhoneMatch[0].replace(/\s+/g, ' ').trim();
            }
            
            // Try to extract email from the leader info
            let contactEmail = undefined;
            const leaderEmailMatch = leaderInfo.match(emailRegex);
            if (leaderEmailMatch) {
                contactEmail = cleanEmail(leaderEmailMatch[0]);
            }
            
            contactPersons.push({ 
                name: leaderName,
                phoneNumber: contactPhone,
                email: contactEmail
            });
        }
        
        // Extract application URL - look for "Søk" or "Apply" buttons
        const applicationUrl = $('a:contains("Søk"), a:contains("Apply"), a.button--attention').attr('href') || undefined;
        
        // Find location information
        let location = undefined;
        if ($('span.pr-8.font-bold:contains("Sted")').length > 0) {
            location = $('span.pr-8.font-bold:contains("Sted")').next().text().trim();
        } else if ($('li:contains("Sted")').length > 0) {
            location = $('li:contains("Sted")').text().replace('Sted', '').trim();
        } else {
            // Try to extract postal code and city from any available address
            const addressText = $('section:contains("Firmaets beliggenhet") p').text().trim();
            if (addressText) {
                location = addressText;
            }
        }
        
        // Find employment type
        let employmentType = undefined;
        const employmentTypeLabels = [
            'Fast', 'Deltid', 'Heltid', 'Engasjement', 'Prosjekt', 'Sesong',
            'Vikariat', 'Franchise', 'Selvstendig næringsdrivende', 'Timebasert'
        ];
        
        for (const label of employmentTypeLabels) {
            if (jobDetailsText.includes(label)) {
                employmentType = label;
                break;
            }
        }
        
        if (!employmentType && $('li:contains("Ansettelsesform")').length > 0) {
            employmentType = $('li:contains("Ansettelsesform")').text().replace('Ansettelsesform', '').trim();
        }
        
        // Find deadlines and publication dates
        let expirationDate = undefined;
        if ($('li:contains("Frist")').length > 0) {
            expirationDate = $('li:contains("Frist")').find('.font-bold').text().trim();
        } else if ($('span:contains("Frist")').length > 0) {
            expirationDate = $('span:contains("Frist")').parent().text().replace('Frist', '').trim();
        }
        
        // Get publication date from metadata
        const publicationDateElement = $('time[datetime]');
        const publicationDate = publicationDateElement.length > 0 
            ? publicationDateElement.attr('datetime') 
            : $('li:contains("Sist endret")').text().replace('Sist endret', '').trim();
        
        // Create the job data object
        const jobData: JobData = {
            url: request.url,
            title,
            description,
            company,
            contactPersons: contactPersons.length > 0 ? contactPersons : undefined,
            email,
            applicationUrl,
            location,
            employmentType,
            publicationDate,
            expirationDate,
            finnkode,
            companyLogoUrl
        };
        
        log.info('Extracted job data:', { title, company, finnkode });
        
        // Save the job data to the dataset
        await Dataset.pushData(jobData);
        
        // Increment the counter for scraped jobs
        scrapedJobsCount++;
        
        log.info(`Successfully scraped job: ${title}`);
    } catch (error) {
        log.error(`Error processing job detail page ${request.url}`, { error: (error as Error).message });
        // Continue with the next job even if there's an error
    }
});

// Add a default handler for any URLs that don't match other patterns
router.addDefaultHandler(async ({ request, log }) => {
    log.info(`Received unexpected URL: ${request.url}`);
    
    // If it's from finn.no, try to determine what type it is
    if (request.url.includes('finn.no')) {
        if (request.url.includes('/search.html')) {
            log.info(`This appears to be a search page, but wasn't properly labeled: ${request.url}`);
        } else if (request.url.includes('/ad.html')) {
            log.info(`This appears to be a detail page, but wasn't properly labeled: ${request.url}`);
        }
    } else {
        log.warning(`Skipping non-Finn.no URL: ${request.url}`);
    }
});

// Create and configure the crawler
const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: 10,
    requestHandler: router,
    // Add error handling to be robust against website changes
    failedRequestHandler: async ({ request, log }) => {
        log.warning(`Request ${request.url} failed`);
    },
});

// Start with the search URL provided in the input
await crawler.run([
    new Request({
        url: searchUrl,
        label: 'LIST'
    })
]);

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();
