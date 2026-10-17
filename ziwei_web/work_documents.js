'use strict';
const {Document,Packer,Paragraph,HeadingLevel}=require('docx');
const PptxGenJS=require('pptxgenjs'),ExcelJS=require('exceljs'),PDFDocument=require('pdfkit');
const fs=require('node:fs');
const MIME={word:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ppt:'application/vnd.openxmlformats-officedocument.presentationml.presentation',excel:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf'};
const EXT={word:'docx',ppt:'pptx',excel:'xlsx',pdf:'pdf'};
async function documentBytes(kind,title,text){
 if(typeof text!=='string'||!text.trim()||text.length>48000)throw Error('invalid_document_text');
 const lines=text.split(/\n/);if(lines.length>1200||lines.some(x=>x.length>6000))throw Error('document_content_limit');
 if(kind==='word')return Packer.toBuffer(new Document({sections:[{children:[new Paragraph({text:title,heading:HeadingLevel.TITLE}),...lines.map(text=>{const h=/^(#{1,3})\s+(.+)$/.exec(text);return new Paragraph(h?{text:h[2],heading:[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3][h[1].length-1]}:{text});})]}]}));
 if(kind==='ppt'){
  const ppt=new PptxGenJS();ppt.layout='LAYOUT_WIDE';ppt.author='知微之家 Work';ppt.subject=title;ppt.title=title;ppt.lang='zh-CN';
  const sections=text.split(/(?=^#{1,3}\s+)/m).filter(x=>x.trim()),blocks=sections.length>1?sections:text.split(/\n\s*\n/).filter(Boolean);let pages=[];
  for(const block of blocks){const h=/^#{1,3}\s+([^\n]+)\n?/.exec(block),heading=h?h[1]:title,content=h?block.slice(h[0].length):block;for(let n=0;n<Math.max(1,content.length);n+=1000)pages.push({heading,body:content.slice(n,n+1000)});}
  if(pages.length>32)throw Error('document_page_limit');
  pages.forEach(({heading,body},i)=>{const slide=ppt.addSlide();slide.background={color:'F8F4F2'};slide.addShape(ppt.ShapeType.rect,{x:0,y:0,w:.18,h:7.5,fill:{color:'9A6C82'},line:{color:'9A6C82'}});slide.addText(heading,{x:.7,y:.4,w:11.9,h:.7,fontFace:'Noto Sans CJK SC',fontSize:26,color:'674958',breakLine:false,fit:'shrink'});slide.addText(body,{x:.7,y:1.4,w:11.8,h:5.3,fontFace:'Noto Sans CJK SC',fontSize:20,color:'3E343B',margin:8,fit:'shrink'});slide.addText((i+1)+' / '+pages.length,{x:11.7,y:7,w:1,h:.25,fontSize:10,color:'674958',align:'right'});});
  return ppt.write({outputType:'nodebuffer'});
 }
 if(kind==='excel'){
  const workbook=new ExcelJS.Workbook();workbook.creator='知微之家 Work';const sheet=workbook.addWorksheet('工作成果');
  sheet.addRow([title]);sheet.getRow(1).font={bold:true,size:16};
  for(const line of lines)sheet.addRow(line.replace(/^\|\s*|\s*\|$/g,'').split(/\t|\s*\|\s*/).slice(0,20).map(v=>String(v)));
  sheet.columns.forEach(c=>{c.width=30;c.alignment={vertical:'top',wrapText:true};});sheet.views=[{state:'frozen',ySplit:1}];return Buffer.from(await workbook.xlsx.writeBuffer());
 }
 if(kind==='pdf')return new Promise((resolve,reject)=>{
  const pdf=new PDFDocument({size:'A4',margin:48,info:{Title:title,Author:'知微之家 Work'}}),chunks=[];
  pdf.on('data',x=>chunks.push(x));pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);
  const font=process.env.WORK_CJK_FONT||'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
  if(!fs.existsSync(font)){pdf.end();return reject(Error('document_font_missing'));}
  try{pdf.font(font,font.endsWith('.ttc')?'NotoSansCJKsc-Regular':undefined).fontSize(20).text(title).moveDown().fontSize(11).text(text,{lineGap:5});pdf.end();}catch(e){reject(e);}
 });
 throw Error('unsupported_document_tool');
}
module.exports={documentBytes,MIME,EXT};
